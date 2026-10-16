/**
 * Dependency-aware, in-memory workflow runner.
 * Guarantees: validated DAG, bounded scheduled concurrency, retry limits,
 * monotonic events and dependency-failure propagation.
 * Does NOT guarantee persistence, exactly-once effects or hard cancellation.
 */
export type TaskState='pending'|'running'|'completed'|'failed'|'skipped';
export interface TaskContext {readonly signal:AbortSignal;readonly attempt:number;readonly results:ReadonlyMap<string,unknown>}
export interface Task {readonly id:string;readonly dependsOn?:readonly string[];readonly retries?:number;readonly timeoutMs?:number;readonly run:(context:TaskContext)=>Promise<unknown>}
export type EventType='started'|'completed'|'failed'|'retrying'|'skipped';
export type WorkflowEvent=Readonly<{sequence:number;taskId:string;type:EventType;attempt:number;timestamp:number;detail?:string}>;
export interface Result {readonly states:Readonly<Record<string,TaskState>>;readonly values:Readonly<Record<string,unknown>>;readonly events:readonly WorkflowEvent[]}
export interface EngineOptions {readonly concurrency?:number;readonly defaultTimeoutMs?:number;readonly retryDelayMs?:number;readonly onEvent?:(event:WorkflowEvent)=>void;readonly now?:()=>number}
export class WorkflowValidationError extends Error {constructor(message:string){super(message);this.name='WorkflowValidationError'}}
export class TaskTimeoutError extends Error {constructor(id:string){super('Timeout: '+id);this.name='TaskTimeoutError'}}
export function validateWorkflow(tasks:readonly Task[],concurrency=2):void {
 if(!Number.isSafeInteger(concurrency)||concurrency<1)throw new WorkflowValidationError('concurrency must be a positive integer');
 const byId=new Map<string,Task>();
 for(const task of tasks){
  if(typeof task.id!=='string'||!task.id.trim()||byId.has(task.id))throw new WorkflowValidationError('Invalid or duplicate task ID: '+task.id);
  if(typeof task.run!=='function')throw new WorkflowValidationError('Missing run callback: '+task.id);
  if(task.retries!==undefined&&(!Number.isSafeInteger(task.retries)||task.retries<0||task.retries>100))throw new WorkflowValidationError('Invalid retries: '+task.id);
  if(task.timeoutMs!==undefined&&(!Number.isFinite(task.timeoutMs)||task.timeoutMs<=0))throw new WorkflowValidationError('Invalid timeout: '+task.id);
  byId.set(task.id,task);
 }
 for(const task of tasks){
  const deps=task.dependsOn??[];
  if(new Set(deps).size!==deps.length)throw new WorkflowValidationError('Duplicate dependency for '+task.id);
  for(const dep of deps)if(!byId.has(dep))throw new WorkflowValidationError('Unknown dependency '+dep+' for '+task.id);
 }
 const state=new Map<string,0|1|2>();
 for(const task of tasks){
  if(state.get(task.id)===2)continue;
  const stack:Array<{id:string;exit:boolean}>=[{id:task.id,exit:false}];
  while(stack.length){
   const current=stack.pop()!;
   if(current.exit){state.set(current.id,2);continue}
   if(state.get(current.id)===2)continue;
   if(state.get(current.id)===1)throw new WorkflowValidationError('Dependency cycle involving '+current.id);
   state.set(current.id,1);stack.push({id:current.id,exit:true});
   for(const dep of [...(byId.get(current.id)!.dependsOn??[])].reverse()){
    if(state.get(dep)===1)throw new WorkflowValidationError('Dependency cycle involving '+dep);
    if(state.get(dep)!==2)stack.push({id:dep,exit:false});
   }
  }
 }
}
const errorMessage=(e:unknown):string=>e instanceof Error?e.message:String(e);
const abortError=()=>new Error('Workflow aborted');
async function invoke(task:Task,attempt:number,defaultTimeout:number,results:ReadonlyMap<string,unknown>,outer?:AbortSignal):Promise<unknown>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 let detach:(()=>void)|undefined;
 let inner:(()=>void)|undefined;
 const guarded=new Promise<never>((_,reject)=>{
  inner=()=>reject(controller.signal.reason instanceof Error?controller.signal.reason:abortError());
  controller.signal.addEventListener('abort',inner,{once:true});
  const forward=()=>controller.abort(abortError());
  outer?.addEventListener('abort',forward,{once:true});
  detach=()=>outer?.removeEventListener('abort',forward);
  timer=setTimeout(()=>controller.abort(new TaskTimeoutError(task.id)),task.timeoutMs??defaultTimeout);
  if(outer?.aborted)forward();
 });
 try{return await Promise.race([guarded,Promise.resolve().then(()=>{
  if(controller.signal.aborted)throw abortError();
  return task.run({signal:controller.signal,attempt,results});
 })]);}
 finally{if(timer)clearTimeout(timer);detach?.();if(inner)controller.signal.removeEventListener('abort',inner)}
}
async function delay(ms:number,signal?:AbortSignal):Promise<void>{
 if(!ms)return;
 if(signal?.aborted)throw abortError();
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();resolve()},ms);
  const onAbort=()=>{clearTimeout(timer);cleanup();reject(abortError())};
  const cleanup=()=>signal?.removeEventListener('abort',onAbort);
  signal?.addEventListener('abort',onAbort,{once:true});
 });
}
export async function runWorkflow(tasks:readonly Task[],options:EngineOptions={},signal?:AbortSignal):Promise<Result>{
 const concurrency=options.concurrency??2,timeout=options.defaultTimeoutMs??30000,retryDelay=options.retryDelayMs??0;
 validateWorkflow(tasks,concurrency);
 if(!Number.isFinite(timeout)||timeout<=0)throw new WorkflowValidationError('defaultTimeoutMs must be positive');
 if(!Number.isFinite(retryDelay)||retryDelay<0||retryDelay>60000)throw new WorkflowValidationError('retryDelayMs must be within 0 and 60000');
 const states:Record<string,TaskState>=Object.fromEntries(tasks.map(t=>[t.id,'pending']));
 const values:Record<string,unknown>={},results=new Map<string,unknown>(),events:WorkflowEvent[]=[];
 const emit=(taskId:string,type:EventType,attempt:number,detail?:string)=>{
  const event:Object=Object.freeze({sequence:events.length+1,taskId,type,attempt,timestamp:(options.now??Date.now)(),...(detail===undefined?{}:{detail})});
  const record=event as WorkflowEvent;events.push(record);
  try{options.onEvent?.(record)}catch{/* callbacks are diagnostic only */}
 };
 const inFlight=new Set<Promise<void>>();
 const execute=async(task:Task):Promise<void>=>{
  const limit=task.retries??0;
  for(let attempt=1;attempt<=limit+1;attempt++){
   if(signal?.aborted){states[task.id]='failed';emit(task.id,'failed',attempt,'Workflow aborted');return}
   states[task.id]='running';emit(task.id,'started',attempt);
   try{
    const value=await invoke(task,attempt,timeout,results,signal);
    values[task.id]=value;results.set(task.id,value);states[task.id]='completed';emit(task.id,'completed',attempt);return;
   }catch(e){
    const detail=errorMessage(e);
    if(attempt<=limit&&!signal?.aborted){
     emit(task.id,'retrying',attempt,detail);
     try{await delay(Math.min(60000,retryDelay*2**Math.min(attempt-1,16)),signal)}catch{}
     continue;
    }
    states[task.id]='failed';emit(task.id,'failed',attempt,detail);return;
   }
  }
 };
 while(Object.values(states).some(s=>s==='pending')||inFlight.size){
  for(const task of tasks){
   if(states[task.id]!=='pending')continue;
   if(signal?.aborted||(task.dependsOn??[]).some(d=>states[d]==='failed'||states[d]==='skipped')){
    states[task.id]='skipped';emit(task.id,'skipped',0,signal?.aborted?'Workflow aborted':'Dependency did not complete');
   }
  }
  for(const task of tasks){
   if(inFlight.size>=concurrency)break;
   if(states[task.id]!=='pending')continue;
   if((task.dependsOn??[]).every(d=>states[d]==='completed')){
    states[task.id]='running';
    const running=execute(task);
    const tracked=running.finally(()=>{inFlight.delete(tracked)});
    inFlight.add(tracked);
   }
  }
  if(inFlight.size)await Promise.race(inFlight);
  else if(Object.values(states).some(s=>s==='pending'))throw new Error('Workflow deadlocked');
 }
 return Object.freeze({states:Object.freeze({...states}),values:Object.freeze({...values}),events:Object.freeze([...events])});
}
