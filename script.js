
/* =========================================================================
   C CODE VISUALIZER — tokenizer, parser, interpreter, and UI
   ========================================================================= */

/* ---------------------------- Tokenizer --------------------------------- */
const KEYWORDS = new Set(['int','float','double','char','void','bool','if','else','for','while',
  'return','break','continue','true','false','const','struct']);
const TYPE_KEYWORDS = new Set(['int','float','double','char','void','bool','FILE']);

function tokenize(src){
  const tokens=[]; let i=0, line=1;
  const isDigit=c=>c>='0'&&c<='9';
  const isAlpha=c=>/[a-zA-Z_]/.test(c);
  while(i<src.length){
    const c=src[i];
    if(c==='\n'){line++;i++;continue;}
    if(/\s/.test(c)){i++;continue;}
    if(c==='/'&&src[i+1]==='/'){while(i<src.length&&src[i]!=='\n')i++;continue;}
    if(c==='/'&&src[i+1]==='*'){i+=2;while(i<src.length-1&&!(src[i]==='*'&&src[i+1]==='/')){if(src[i]==='\n')line++;i++;} i+=2;continue;}
    if(c==='#'){while(i<src.length&&src[i]!=='\n')i++;continue;}
    if(isDigit(c)||(c==='.'&&isDigit(src[i+1]))){
      let start=i,isFloat=false;
      while(i<src.length&&/[0-9.]/.test(src[i])){if(src[i]==='.')isFloat=true;i++;}
      if(src[i]==='f'||src[i]==='F'){i++;isFloat=true;}
      tokens.push({type:'number',value:parseFloat(src.slice(start,i)),isFloat,line});
      continue;
    }
    if(isAlpha(c)){
      let start=i; while(i<src.length&&/[a-zA-Z0-9_]/.test(src[i]))i++;
      const word=src.slice(start,i);
      tokens.push({type:KEYWORDS.has(word)?'keyword':'identifier',value:word,line});
      continue;
    }
    if(c==='"'){
      i++;let s='';
      while(i<src.length&&src[i]!=='"'){
        if(src[i]==='\\'){i++;const e=src[i];s+= e==='n'?'\n':e==='t'?'\t':e==='\\'?'\\':e;i++;}
        else{s+=src[i];i++;}
      }
      i++;tokens.push({type:'string',value:s,line});continue;
    }
    if(c==="'"){
      i++;let ch;
      if(src[i]==='\\'){i++;const e=src[i];ch= e==='n'?'\n':e==='t'?'\t':e==='0'?'\0':e;i++;}
      else{ch=src[i];i++;}
      i++;tokens.push({type:'char',value:ch,line});continue;
    }
    const three=src.substr(i,3);
    if(['<<=','>>='].includes(three)){tokens.push({type:'op',value:three,line});i+=3;continue;}
    const two=src.substr(i,2);
    if(['==','!=','<=','>=','&&','||','++','--','+=','-=','*=','/=','%=','->'].includes(two)){
      tokens.push({type:'op',value:two,line});i+=2;continue;
    }
    if('+-*/%=<>!&|^~'.includes(c)){tokens.push({type:'op',value:c,line});i++;continue;}
    if('(){}[];,.'.includes(c)){tokens.push({type:'punc',value:c,line});i++;continue;}
    i++;
  }
  tokens.push({type:'eof',value:'',line});
  return tokens;
}

/* ------------------------------ Parser ----------------------------------- */
class Parser{
  constructor(tokens){this.tokens=tokens;this.pos=0;}
  peek(){return this.tokens[this.pos];}
  advance(){return this.tokens[this.pos++];}
  expect(type,value){
    const t=this.advance();
    if(t.type!==type || (value!==undefined && t.value!==value))
      throw new Error(`Parse error: expected '${value||type}' but got '${t.value}' at line ${t.line}`);
    return t;
  }
  isTypeKeyword(){
    const t=this.peek();
    return TYPE_KEYWORDS.has(t.value) || (t.type==='keyword'&&t.value==='struct');
  }
  /* Consumes a type name: a basic type keyword, or `struct Name`. Returns the type string. */
  parseTypeName(){
    if(this.peek().type==='keyword'&&this.peek().value==='struct'){
      this.advance();
      const name=this.expect('identifier').value;
      return 'struct '+name;
    }
    return this.advance().value;
  }
  /* Consumes zero or more leading '*' tokens (pointer / pointer-to-pointer). */
  consumeStars(){
    let n=0;
    while(this.peek().type==='op'&&this.peek().value==='*'){this.advance();n++;}
    return n;
  }

  parseProgram(){
    const items=[];
    while(this.peek().type!=='eof'){
      if(this.peek().type==='keyword'&&this.peek().value==='struct'&&
         this.tokens[this.pos+1]&&this.tokens[this.pos+1].type==='identifier'&&
         this.tokens[this.pos+2]&&this.tokens[this.pos+2].type==='punc'&&this.tokens[this.pos+2].value==='{'){
        items.push(this.parseStructDecl());
        continue;
      }
      if(!this.isTypeKeyword()) throw new Error(`Unexpected token '${this.peek().value}' at line ${this.peek().line}`);
      const saved=this.pos;
      this.parseTypeName();
      this.consumeStars();
      if(this.peek().type==='identifier') this.advance();
      const isFunc = this.peek().type==='punc'&&this.peek().value==='(';
      this.pos=saved;
      items.push(isFunc?this.parseFunction():this.parseVarDecl());
    }
    return {type:'Program',items};
  }

  /* struct Name { type field; ... }; */
  parseStructDecl(){
    const line=this.peek().line;
    this.expect('keyword','struct');
    const name=this.expect('identifier').value;
    this.expect('punc','{');
    const fields=[];
    while(!(this.peek().type==='punc'&&this.peek().value==='}')){
      const ftype=this.parseTypeName();
      const isPointer=this.consumeStars()>0;
      const fname=this.expect('identifier').value;
      let isArray=false, arraySize=null;
      if(this.peek().type==='punc'&&this.peek().value==='['){
        this.advance();
        if(!(this.peek().type==='punc'&&this.peek().value===']')) arraySize=this.parseExpr();
        this.expect('punc',']'); isArray=true;
      }
      fields.push({type:ftype,name:fname,isPointer,isArray,arraySize});
      this.expect('punc',';');
    }
    this.expect('punc','}');
    this.expect('punc',';');
    return {type:'StructDecl',name,fields,line};
  }

  parseFunction(){
    const returnType=this.parseTypeName();
    const isPointer=this.consumeStars()>0;
    const name=this.expect('identifier').value;
    this.expect('punc','(');
    const params=[];
    while(!(this.peek().type==='punc'&&this.peek().value===')')){
      const ptype=this.parseTypeName();
      const pptr=this.consumeStars()>0;
      let pname='';
      if(this.peek().type==='identifier') pname=this.advance().value;
      let isArr=false;
      if(this.peek().type==='punc'&&this.peek().value==='['){
        this.advance();
        if(!(this.peek().type==='punc'&&this.peek().value===']')) this.parseExpr();
        this.expect('punc',']'); isArr=true;
      }
      params.push({type:ptype,name:pname,isPointer:pptr,isArray:isArr});
      if(this.peek().type==='punc'&&this.peek().value===',') this.advance();
    }
    this.expect('punc',')');
    const body=this.parseBlock();
    return {type:'FunctionDecl',name,returnType,isPointer,params,body,line:body.line};
  }

  parseBlock(){
    const line=this.peek().line;
    this.expect('punc','{');
    const body=[];
    while(!(this.peek().type==='punc'&&this.peek().value==='}')) body.push(this.parseStatement());
    this.expect('punc','}');
    return {type:'Block',body,line};
  }

  parseStatement(){
    const t=this.peek();
    if(t.type==='punc'&&t.value==='{') return this.parseBlock();
    if(t.type==='keyword'){
      if(t.value==='if') return this.parseIf();
      if(t.value==='for') return this.parseFor();
      if(t.value==='while') return this.parseWhile();
      if(t.value==='return') return this.parseReturn();
      if(t.value==='break'){this.advance();this.expect('punc',';');return {type:'Break',line:t.line};}
      if(t.value==='continue'){this.advance();this.expect('punc',';');return {type:'Continue',line:t.line};}
    }
    if(this.isTypeKeyword()) return this.parseVarDecl();
    return this.parseExprStmt();
  }

  parseVarDecl(){
    const line=this.peek().line;
    if(this.peek().type==='keyword'&&this.peek().value==='const') this.advance();
    let vtype=this.parseTypeName();
    const decls=[];
    for(;;){
      const isPointer=this.consumeStars()>0;
      const name=this.expect('identifier').value;
      let isArray=false, arraySize=null, arrayInit=null, init=null, structInit=null;
      if(this.peek().type==='punc'&&this.peek().value==='['){
        this.advance();
        if(!(this.peek().type==='punc'&&this.peek().value===']')) arraySize=this.parseExpr();
        this.expect('punc',']'); isArray=true;
        if(this.peek().type==='op'&&this.peek().value==='='){
          this.advance(); this.expect('punc','{'); arrayInit=[];
          while(!(this.peek().type==='punc'&&this.peek().value==='}')){
            arrayInit.push(this.parseExpr());
            if(this.peek().type==='punc'&&this.peek().value===',') this.advance();
          }
          this.expect('punc','}');
        }
      } else if(this.peek().type==='op'&&this.peek().value==='='){
        this.advance();
        if(this.peek().type==='punc'&&this.peek().value==='{'){
          this.advance(); structInit=[];
          while(!(this.peek().type==='punc'&&this.peek().value==='}')){
            structInit.push(this.parseExpr());
            if(this.peek().type==='punc'&&this.peek().value===',') this.advance();
          }
          this.expect('punc','}');
        } else init=this.parseExpr();
      }
      decls.push({type:'VarDecl',varType:vtype,name,isPointer,isArray,arraySize,arrayInit,init,structInit,line});
      if(this.peek().type==='punc'&&this.peek().value===','){this.advance();continue;}
      break;
    }
    this.expect('punc',';');
    return decls.length===1?decls[0]:{type:'MultiVarDecl',declarations:decls,line};
  }

  parseIf(){
    const line=this.advance().line;
    this.expect('punc','('); const condition=this.parseExpr(); this.expect('punc',')');
    const then=this.parseStatement();
    let elseBody=null;
    if(this.peek().type==='keyword'&&this.peek().value==='else'){this.advance();elseBody=this.parseStatement();}
    return {type:'If',condition,then,elseBody,line};
  }

  parseFor(){
    const line=this.advance().line;
    this.expect('punc','(');
    let init=null;
    if(this.peek().type==='punc'&&this.peek().value===';'){this.advance();}
    else if(this.isTypeKeyword()){init=this.parseVarDecl();}
    else{const eline=this.peek().line;const expr=this.parseExpr();this.expect('punc',';');init={type:'ExprStmt',expr,line:eline};}
    let condition=null;
    if(!(this.peek().type==='punc'&&this.peek().value===';')) condition=this.parseExpr();
    this.expect('punc',';');
    let update=null;
    if(!(this.peek().type==='punc'&&this.peek().value===')')) update=this.parseExpr();
    this.expect('punc',')');
    const body=this.parseStatement();
    return {type:'For',init,condition,update,body,line};
  }

  parseWhile(){
    const line=this.advance().line;
    this.expect('punc','('); const condition=this.parseExpr(); this.expect('punc',')');
    const body=this.parseStatement();
    return {type:'While',condition,body,line};
  }

  parseReturn(){
    const line=this.advance().line;
    let value=null;
    if(!(this.peek().type==='punc'&&this.peek().value===';')) value=this.parseExpr();
    this.expect('punc',';');
    return {type:'Return',value,line};
  }

  parseExprStmt(){
    const line=this.peek().line;
    const expr=this.parseExpr();
    this.expect('punc',';');
    return {type:'ExprStmt',expr,line};
  }

  parseExpr(){return this.parseAssignment();}
  parseAssignment(){
    const left=this.parseLogicalOr();
    const t=this.peek();
    if(t.type==='op'&&t.value==='='){this.advance();return {type:'Assign',target:left,value:this.parseAssignment(),line:t.line};}
    if(t.type==='op'&&['+=','-=','*=','/=','%='].includes(t.value)){this.advance();return {type:'CompoundAssign',operator:t.value,target:left,value:this.parseAssignment(),line:t.line};}
    return left;
  }
  parseLogicalOr(){let l=this.parseLogicalAnd();while(this.peek().type==='op'&&this.peek().value==='||'){const line=this.advance().line;l={type:'Binary',operator:'||',left:l,right:this.parseLogicalAnd(),line};}return l;}
  parseLogicalAnd(){let l=this.parseEquality();while(this.peek().type==='op'&&this.peek().value==='&&'){const line=this.advance().line;l={type:'Binary',operator:'&&',left:l,right:this.parseEquality(),line};}return l;}
  parseEquality(){let l=this.parseComparison();while(this.peek().type==='op'&&['==','!='].includes(this.peek().value)){const op=this.advance();l={type:'Binary',operator:op.value,left:l,right:this.parseComparison(),line:op.line};}return l;}
  parseComparison(){let l=this.parseAddition();while(this.peek().type==='op'&&['<','>','<=','>='].includes(this.peek().value)){const op=this.advance();l={type:'Binary',operator:op.value,left:l,right:this.parseAddition(),line:op.line};}return l;}
  parseAddition(){let l=this.parseMultiplication();while(this.peek().type==='op'&&['+','-'].includes(this.peek().value)){const op=this.advance();l={type:'Binary',operator:op.value,left:l,right:this.parseMultiplication(),line:op.line};}return l;}
  parseMultiplication(){let l=this.parseUnary();while(this.peek().type==='op'&&['*','/','%'].includes(this.peek().value)){const op=this.advance();l={type:'Binary',operator:op.value,left:l,right:this.parseUnary(),line:op.line};}return l;}
  parseUnary(){
    const t=this.peek();
    if(t.type==='op'){
      if(t.value==='!'){this.advance();return {type:'Unary',operator:'!',operand:this.parseUnary(),line:t.line};}
      if(t.value==='-'){this.advance();return {type:'Unary',operator:'-',operand:this.parseUnary(),line:t.line};}
      if(t.value==='*'){this.advance();return {type:'Deref',operand:this.parseUnary(),line:t.line};}
      if(t.value==='&'){this.advance();return {type:'AddressOf',operand:this.parseUnary(),line:t.line};}
      if(t.value==='++'){this.advance();return {type:'PrefixInc',operand:this.parseUnary(),line:t.line};}
      if(t.value==='--'){this.advance();return {type:'PrefixDec',operand:this.parseUnary(),line:t.line};}
    }
    return this.parsePostfix();
  }
  parsePostfix(){
    let expr=this.parsePrimary();
    for(;;){
      if(this.peek().type==='punc'&&this.peek().value==='['){
        this.advance();const idx=this.parseExpr();this.expect('punc',']');
        expr={type:'ArrayAccess',array:expr,index:idx,line:expr.line};
      } else if(this.peek().type==='punc'&&this.peek().value==='('){
        this.advance();const args=[];
        while(!(this.peek().type==='punc'&&this.peek().value===')')){
          args.push(this.parseExpr());
          if(this.peek().type==='punc'&&this.peek().value===',') this.advance();
        }
        this.expect('punc',')');
        expr={type:'Call',callee:expr,args,line:expr.line};
      } else if(this.peek().type==='op'&&this.peek().value==='++'){this.advance();expr={type:'PostfixInc',operand:expr,line:expr.line};}
      else if(this.peek().type==='op'&&this.peek().value==='--'){this.advance();expr={type:'PostfixDec',operand:expr,line:expr.line};}
      else if(this.peek().type==='punc'&&this.peek().value==='.'){
        this.advance(); const member=this.expect('identifier').value;
        expr={type:'Member',object:expr,member,arrow:false,line:expr.line};
      } else if(this.peek().type==='op'&&this.peek().value==='->'){
        this.advance(); const member=this.expect('identifier').value;
        expr={type:'Member',object:expr,member,arrow:true,line:expr.line};
      }
      else break;
    }
    return expr;
  }
  parsePrimary(){
    const t=this.peek();
    if(t.type==='identifier'&&t.value==='sizeof'&&this.tokens[this.pos+1]&&this.tokens[this.pos+1].type==='punc'&&this.tokens[this.pos+1].value==='('){
      const save=this.pos;
      this.advance(); this.advance();
      if(this.isTypeKeyword()){
        const typeName=this.parseTypeName();
        this.consumeStars();
        this.expect('punc',')');
        return {type:'SizeofType',typeName,line:t.line};
      }
      this.pos=save;
    }
    if(t.type==='number'){this.advance();return {type:'NumberLit',value:t.value,isFloat:t.isFloat,line:t.line};}
    if(t.type==='string'){this.advance();return {type:'StringLit',value:t.value,line:t.line};}
    if(t.type==='char'){this.advance();return {type:'CharLit',value:t.value,line:t.line};}
    if(t.type==='keyword'&&t.value==='true'){this.advance();return {type:'BoolLit',value:true,line:t.line};}
    if(t.type==='keyword'&&t.value==='false'){this.advance();return {type:'BoolLit',value:false,line:t.line};}
    if(t.type==='identifier'){this.advance();return {type:'Identifier',name:t.value,line:t.line};}
    if(t.type==='punc'&&t.value==='('){this.advance();const e=this.parseExpr();this.expect('punc',')');return e;}
    throw new Error(`Unexpected token '${t.value}' at line ${t.line}`);
  }
}

/* --------------------------- Interpreter --------------------------------- */
class ReturnSignal{constructor(v){this.value=v;}}
class BreakSignal{}
class ContinueSignal{}

class Interpreter{
  constructor(){
    this.functions=new Map();
    this.callStack=[];
    this.globals=new Map();
    this.output='';
    this.steps=[];
    this.nextAddr=1;
    this.addrMap=new Map();
    this.maxSteps=10000;
    this.maxDepth=200;
    this.stdin=[];
    this.stdinPos=0;
    this.pendingSwap=new Map(); // address -> {idx, oldVal, newVal} — tracks a single-index array change awaiting a partner change to confirm a swap
    this.structs=new Map();       // struct name -> field defs
    this.files=new Map();         // simulated filesystem: filename -> string content
    this.fileHandles=new Map();   // handle number -> {filename, mode, tokens?}
    this.nextFileHandle=1;
  }
  run(program, stdinText){
    this.stdin=(stdinText||'').split(/\s+/).filter(Boolean);
    for(const item of program.items){
      if(item.type==='StructDecl') this.structs.set(item.name,item.fields);
    }
    for(const item of program.items){
      if(item.type==='FunctionDecl') this.functions.set(item.name,item);
    }
    for(const item of program.items){
      if(item.type!=='FunctionDecl' && item.type!=='StructDecl') this.execVarDecl(item);
    }
    if(!this.functions.has('main')) throw new Error("No main() function found");
    if(this.steps.length===0 || this.globals.size>0) this.recordStep(this.functions.get('main').line);
    try{ this.callFunction('main',[]); }
    catch(e){ if(!(e instanceof ReturnSignal)) throw e; }
    return this.steps;
  }
  alloc(entry){const a=this.nextAddr++;this.addrMap.set(a,entry);entry.address=a;return a;}
  lookup(name){
    for(let i=this.callStack.length-1;i>=0;i--){const f=this.callStack[i];if(f.vars.has(name))return f.vars.get(name);}
    if(this.globals.has(name))return this.globals.get(name);
    return null;
  }
  declare(name,type,value,isPointer,isArray){
    const entry={type,value,isPointer:!!isPointer,isArray:!!isArray};
    this.alloc(entry);
    if(this.callStack.length) this.callStack[this.callStack.length-1].vars.set(name,entry);
    else this.globals.set(name,entry);
    return entry;
  }
  makeStructDefault(structName){
    const fields=this.structs.get(structName);
    const obj={};
    if(!fields) return obj;
    for(const f of fields){
      if(f.isPointer) obj[f.name]=0;
      else if(f.isArray) obj[f.name]=new Array(f.arraySize?this.evalExpr(f.arraySize):0).fill(f.type==='char'?'\0':0);
      else if(f.type.startsWith('struct ')) obj[f.name]=this.makeStructDefault(f.type.slice(7));
      else obj[f.name]=f.type==='char'?'\0':0;
    }
    return obj;
  }
  sizeOfType(typeName){
    if(typeName.startsWith('struct ')){
      const fields=this.structs.get(typeName.slice(7))||[];
      return fields.reduce((sum,f)=>sum+(f.isPointer?8:f.type==='char'?1:f.type==='double'?8:4),0)||4;
    }
    if(typeName==='char') return 1;
    if(typeName==='double') return 8;
    return 4; // int, float, bool, void*, etc.
  }
  lastLine(node){
    if(!node) return 0;
    let m=node.line||0;
    if(Array.isArray(node.body)) for(const s of node.body) m=Math.max(m,this.lastLine(s));
    else if(node.body) m=Math.max(m,this.lastLine(node.body));
    if(node.then) m=Math.max(m,this.lastLine(node.then));
    if(node.elseBody) m=Math.max(m,this.lastLine(node.elseBody));
    return m;
  }
  callFunction(name,argVals){
    const fn=this.functions.get(name);
    if(!fn) throw new Error(`Undefined function '${name}'`);
    if(this.callStack.length>=this.maxDepth) throw new Error('Call depth limit exceeded (possible infinite recursion)');
    const frame={name,args:argVals,vars:new Map(),startLine:fn.body.line,endLine:this.lastLine(fn.body),activeLine:fn.line};
    this.callStack.push(frame);
    for(let i=0;i<fn.params.length;i++){
      const p=fn.params[i];
      const entry={type:p.type+(p.isPointer?'*':''),value:argVals[i]!==undefined?argVals[i]:0,isPointer:p.isPointer,isArray:p.isArray};
      this.alloc(entry);
      frame.vars.set(p.name,entry);
    }
    this.recordStep(fn.body.line);
    let ret=0;
    try{ this.execBlock(fn.body); }
    catch(e){ if(e instanceof ReturnSignal) ret=e.value; else throw e; }
    this.callStack.pop();
    return ret;
  }
  execBlock(block){ for(const s of block.body) this.execStmt(s); }
  execStmt(stmt){
    if(this.steps.length>this.maxSteps) throw new Error('Execution limit exceeded (possible infinite loop)');
    switch(stmt.type){
      case 'Block': this.execBlock(stmt); return;
      case 'VarDecl': this.execVarDecl(stmt); this.recordStep(stmt.line); return;
      case 'MultiVarDecl': for(const d of stmt.declarations) this.execVarDecl(d); this.recordStep(stmt.line); return;
      case 'If': {
        const c=this.evalExpr(stmt.condition); this.recordStep(stmt.line);
        if(c) this.execStmt(stmt.then); else if(stmt.elseBody) this.execStmt(stmt.elseBody);
        return;
      }
      case 'For': return this.execFor(stmt);
      case 'While': return this.execWhile(stmt);
      case 'Return': {
        const v=stmt.value?this.evalExpr(stmt.value):0;
        this.recordStep(stmt.line);
        throw new ReturnSignal(v);
      }
      case 'Break': throw new BreakSignal();
      case 'Continue': throw new ContinueSignal();
      case 'ExprStmt': this.evalExpr(stmt.expr); this.recordStep(stmt.line); return;
    }
  }
  execVarDecl(d){
    const isStruct=d.varType.startsWith('struct ');
    const structName=isStruct?d.varType.slice(7):null;
    if(d.isArray){
      let arr;
      if(isStruct && !d.isPointer){
        const size=d.arraySize?this.evalExpr(d.arraySize):0;
        arr=new Array(size).fill(0).map(()=>this.makeStructDefault(structName));
      } else if(d.arrayInit){
        arr=d.arrayInit.map(e=>this.evalExpr(e));
        if(d.arraySize){ const size=this.evalExpr(d.arraySize); while(arr.length<size) arr.push(0); }
      } else {
        const size=d.arraySize?this.evalExpr(d.arraySize):0;
        arr=new Array(size).fill(d.varType==='char'?'\0':0);
      }
      this.declare(d.name,d.varType,arr,false,true);
    } else if(isStruct && !d.isPointer){
      let v=this.makeStructDefault(structName);
      if(d.structInit){
        const fields=this.structs.get(structName)||[];
        d.structInit.forEach((e,i)=>{ if(fields[i]) v[fields[i].name]=this.evalExpr(e); });
      } else if(d.init){
        v=this.evalExpr(d.init);
      }
      this.declare(d.name,d.varType,v,false,false);
    } else {
      let v=0;
      if(d.init) v=this.evalExpr(d.init);
      else if(d.varType==='char') v='\0';
      this.declare(d.name,d.varType+(d.isPointer?'*':''),v,d.isPointer,false);
    }
  }
  execFor(stmt){
    if(stmt.init) this.execStmt(stmt.init);
    for(;;){
      if(stmt.condition){ const c=this.evalExpr(stmt.condition); this.recordStep(stmt.line); if(!c) break; }
      else this.recordStep(stmt.line);
      try{ this.execStmt(stmt.body); }
      catch(e){ if(e instanceof BreakSignal) break; if(!(e instanceof ContinueSignal)) throw e; }
      if(stmt.update) this.evalExpr(stmt.update);
    }
  }
  execWhile(stmt){
    for(;;){
      const c=this.evalExpr(stmt.condition); this.recordStep(stmt.line); if(!c) break;
      try{ this.execStmt(stmt.body); }
      catch(e){ if(e instanceof BreakSignal) break; if(e instanceof ContinueSignal) continue; throw e; }
    }
  }
  evalExpr(e){
    switch(e.type){
      case 'NumberLit': return e.value;
      case 'StringLit': return e.value;
      case 'CharLit': return e.value;
      case 'BoolLit': return e.value?1:0;
      case 'Identifier': {
        const ent=this.lookup(e.name);
        if(!ent){
          if(e.name==='EOF') return -1;
          if(e.name==='NULL') return 0;
          throw new Error(`Undefined variable '${e.name}' at line ${e.line}`);
        }
        return ent.value;
      }
      case 'SizeofType': return this.sizeOfType(e.typeName);
      case 'Member': {
        if(e.arrow){
          const addr=this.evalExpr(e.object); const ent=this.addrMap.get(addr);
          if(!ent) throw new Error(`Invalid pointer dereference at line ${e.line}`);
          return ent.value[e.member];
        }
        const obj=this.evalStructRef(e.object);
        if(!obj || typeof obj!=='object') throw new Error(`'.${e.member}' used on a non-struct value at line ${e.line}`);
        return obj[e.member];
      }
      case 'Binary': return this.evalBinary(e);
      case 'Unary': { const v=this.evalExpr(e.operand); return e.operator==='!'?(v?0:1):-v; }
      case 'Assign': { const v=this.evalExpr(e.value); this.assignTo(e.target,v); return v; }
      case 'CompoundAssign': {
        const cur=this.evalExpr(e.target); const rhs=this.evalExpr(e.value); let nv;
        switch(e.operator){case '+=':nv=cur+rhs;break;case '-=':nv=cur-rhs;break;case '*=':nv=cur*rhs;break;case '/=':nv=cur/rhs;break;case '%=':nv=cur%rhs;break;}
        this.assignTo(e.target,nv); return nv;
      }
      case 'PostfixInc': { const v=this.evalExpr(e.operand); this.assignTo(e.operand,v+1); return v; }
      case 'PostfixDec': { const v=this.evalExpr(e.operand); this.assignTo(e.operand,v-1); return v; }
      case 'PrefixInc': { const v=this.evalExpr(e.operand)+1; this.assignTo(e.operand,v); return v; }
      case 'PrefixDec': { const v=this.evalExpr(e.operand)-1; this.assignTo(e.operand,v); return v; }
      case 'ArrayAccess': {
        let arr=this.evalExpr(e.array); const idx=this.evalExpr(e.index);
        if(typeof arr==='number'){ const ent=this.addrMap.get(arr); if(ent&&Array.isArray(ent.value)) arr=ent.value; }
        if(!Array.isArray(arr)&&typeof arr!=='string') throw new Error(`Not an array at line ${e.line}`);
        if(idx<0||idx>=arr.length) throw new Error(`Array index ${idx} out of bounds (size ${arr.length}) at line ${e.line}`);
        return arr[idx];
      }
      case 'AddressOf': {
        if(e.operand.type!=='Identifier') throw new Error(`Cannot take address of this expression at line ${e.line}`);
        const ent=this.lookup(e.operand.name); if(!ent) throw new Error(`Undefined variable '${e.operand.name}'`);
        return ent.address;
      }
      case 'Deref': {
        const addr=this.evalExpr(e.operand); const ent=this.addrMap.get(addr);
        if(!ent) throw new Error(`Invalid pointer dereference at line ${e.line}`);
        return ent.value;
      }
      case 'Call': return this.evalCall(e);
    }
    throw new Error(`Unknown expression '${e.type}'`);
  }
  evalBinary(e){
    if(e.operator==='&&') return (this.evalExpr(e.left)&&this.evalExpr(e.right))?1:0;
    if(e.operator==='||') return (this.evalExpr(e.left)||this.evalExpr(e.right))?1:0;
    let l=this.evalExpr(e.left), r=this.evalExpr(e.right);
    const lc = (typeof l==='string'&&l.length===1)?l.charCodeAt(0):l;
    const rc = (typeof r==='string'&&r.length===1)?r.charCodeAt(0):r;
    switch(e.operator){
      case '+': return (typeof l==='string'&&l.length!==1)||(typeof r==='string'&&r.length!==1) ? String(l)+String(r) : lc+rc;
      case '-': return lc-rc;
      case '*': return lc*rc;
      case '/': return (Number.isInteger(lc)&&Number.isInteger(rc)) ? Math.trunc(lc/rc) : lc/rc;
      case '%': return lc%rc;
      case '==': return lc===rc?1:0;
      case '!=': return lc!==rc?1:0;
      case '<': return lc<rc?1:0;
      case '>': return lc>rc?1:0;
      case '<=': return lc<=rc?1:0;
      case '>=': return lc>=rc?1:0;
    }
  }
  /* Resolves a node to the actual (mutable) struct object it refers to, so `.` chains and
     assignments (p.x = 5, pts[i].x = 5) mutate the real stored struct rather than a copy. */
  evalStructRef(node){
    if(node.type==='Identifier'){
      const ent=this.lookup(node.name); if(!ent) throw new Error(`Undefined variable '${node.name}' at line ${node.line}`);
      return ent.value;
    }
    if(node.type==='Member'){
      if(node.arrow){
        const addr=this.evalExpr(node.object); const ent=this.addrMap.get(addr);
        if(!ent) throw new Error(`Invalid pointer dereference at line ${node.line}`);
        return ent.value[node.member];
      }
      const obj=this.evalStructRef(node.object);
      return obj[node.member];
    }
    if(node.type==='Deref'){
      const addr=this.evalExpr(node.operand); const ent=this.addrMap.get(addr);
      if(!ent) throw new Error(`Invalid pointer dereference at line ${node.line}`);
      return ent.value;
    }
    return this.evalExpr(node); // e.g. ArrayAccess — returns the struct object reference directly
  }
  assignTo(target,val){
    if(target.type==='Identifier'){
      const ent=this.lookup(target.name); if(!ent) throw new Error(`Undefined variable '${target.name}' at line ${target.line}`);
      ent.value = (ent.type==='char'&&typeof val==='number') ? String.fromCharCode(val) : val;
      return;
    }
    if(target.type==='ArrayAccess'){
      let arr=this.evalExpr(target.array); const idx=this.evalExpr(target.index);
      if(typeof arr==='number'){ const ent=this.addrMap.get(arr); if(ent&&Array.isArray(ent.value)) arr=ent.value; }
      if(idx<0||idx>=arr.length) throw new Error(`Array index ${idx} out of bounds at line ${target.line}`);
      arr[idx]=val; return;
    }
    if(target.type==='Deref'){
      const addr=this.evalExpr(target.operand); const ent=this.addrMap.get(addr);
      if(!ent) throw new Error(`Invalid pointer assignment at line ${target.line}`);
      ent.value=val; return;
    }
    if(target.type==='Member'){
      if(target.arrow){
        const addr=this.evalExpr(target.object); const ent=this.addrMap.get(addr);
        if(!ent) throw new Error(`Invalid pointer dereference at line ${target.line}`);
        ent.value[target.member]=val; return;
      }
      const obj=this.evalStructRef(target.object);
      obj[target.member]=val; return;
    }
    throw new Error('Invalid assignment target');
  }
  evalCall(e){
    if(e.callee.type==='Identifier'){
      const fname=e.callee.name;
      if(fname==='printf') return this.builtinPrintf(e.args);
      if(fname==='scanf') return this.builtinScanf(e.args);
      if(fname==='sizeof'){
        const v=this.evalExpr(e.args[0]);
        if(Array.isArray(v)) return v.length*4;
        if(typeof v==='string') return 1;
        return 4;
      }
      if(fname==='malloc'||fname==='calloc'){
        let n;
        if(fname==='malloc'){ const bytes=this.evalExpr(e.args[0]); n=Math.max(1,Math.round(bytes/4)); }
        else { n=Math.max(1,Math.round(this.evalExpr(e.args[0]))); }
        const entry={type:'heap',value:new Array(n).fill(0),isPointer:false,isArray:true,heap:true};
        return this.alloc(entry);
      }
      if(fname==='realloc'){
        const ptr=this.evalExpr(e.args[0]); const bytes=this.evalExpr(e.args[1]);
        const n=Math.max(1,Math.round(bytes/4));
        const old=this.addrMap.get(ptr);
        const newArr=new Array(n).fill(0);
        if(old&&Array.isArray(old.value)) for(let i=0;i<Math.min(n,old.value.length);i++) newArr[i]=old.value[i];
        if(old) this.addrMap.delete(ptr);
        const entry={type:'heap',value:newArr,isPointer:false,isArray:true,heap:true};
        return this.alloc(entry);
      }
      if(fname==='free'){ const ptr=this.evalExpr(e.args[0]); this.addrMap.delete(ptr); return 0; }
      if(fname==='fopen'){
        const filename=String(this.evalExpr(e.args[0])); const mode=String(this.evalExpr(e.args[1]));
        if(mode.includes('w')||!this.files.has(filename)) this.files.set(filename,mode.includes('w')?'':(this.files.get(filename)||''));
        const handle=this.nextFileHandle++;
        this.fileHandles.set(handle,{filename,mode});
        return handle;
      }
      if(fname==='fclose'){
        const handle=this.evalExpr(e.args[0]); const info=this.fileHandles.get(handle);
        if(info){
          this.output+=`\n[file "${info.filename}" closed — contents: "${(this.files.get(info.filename)||'').replace(/\n/g,'\\n')}"]\n`;
          this.fileHandles.delete(handle);
        }
        return 0;
      }
      if(fname==='fprintf'||fname==='fputs'){
        const handle=this.evalExpr(e.args[0]); const info=this.fileHandles.get(handle);
        let out='';
        if(fname==='fputs'){ out=String(this.evalExpr(e.args[1])); }
        else {
          const fmt=this.evalExpr(e.args[1]); let ai=2;
          for(let i=0;i<fmt.length;i++){
            if(fmt[i]==='%'&&i+1<fmt.length){
              const spec=fmt[i+1];
              if(spec==='%'){out+='%';i++;continue;}
              const val=this.evalExpr(e.args[ai++]);
              if(spec==='d') out+=String(Math.trunc(val));
              else if(spec==='f') out+=Number(val).toFixed(6);
              else if(spec==='c') out+= typeof val==='string'?val:String.fromCharCode(val);
              else out+=String(val);
              i++;
            } else out+=fmt[i];
          }
        }
        if(info) this.files.set(info.filename,(this.files.get(info.filename)||'')+out);
        return out.length;
      }
      if(fname==='fscanf'){
        const handle=this.evalExpr(e.args[0]); const info=this.fileHandles.get(handle);
        if(!info) return -1;
        if(!info.tokens) info.tokens=((this.files.get(info.filename))||'').trim().split(/\s+/).filter(Boolean);
        let count=0;
        for(let i=2;i<e.args.length;i++){
          if(!info.tokens.length) break;
          const raw=info.tokens.shift();
          const target=e.args[i]; if(target.type!=='AddressOf') throw new Error('fscanf() argument must be a pointer (&var)');
          const operand=target.operand;
          if(operand.type==='Identifier'){
            const ent=this.lookup(operand.name); if(!ent) throw new Error(`Undefined variable '${operand.name}'`);
            if(ent.type==='char') ent.value=raw[0];
            else if(ent.type==='float'||ent.type==='double') ent.value=parseFloat(raw);
            else ent.value=Math.trunc(parseFloat(raw));
          }
          count++;
        }
        return count;
      }
      const argVals=e.args.map(a=>this.evalExpr(a));
      if(this.callStack.length) this.callStack[this.callStack.length-1].activeLine=e.line;
      return this.callFunction(fname,argVals);
    }
    throw new Error('Unsupported call expression');
  }
  builtinPrintf(args){
    if(args.length===0) return 0;
    const fmt=this.evalExpr(args[0]);
    let ai=1, out='';
    for(let i=0;i<fmt.length;i++){
      if(fmt[i]==='%'&&i+1<fmt.length){
        const spec=fmt[i+1];
        if(spec==='%'){out+='%';i++;continue;}
        const val=this.evalExpr(args[ai++]);
        if(spec==='d') out+=String(Math.trunc(val));
        else if(spec==='f') out+=Number(val).toFixed(6);
        else if(spec==='c') out+= typeof val==='string'?val:String.fromCharCode(val);
        else if(spec==='s') out+=String(val);
        else out+=String(val);
        i++;
      } else out+=fmt[i];
    }
    this.output+=out;
    return 0;
  }
  builtinScanf(args){
    for(let i=1;i<args.length;i++){
      if(this.stdinPos>=this.stdin.length) throw new Error('Not enough input provided for scanf()');
      const raw=this.stdin[this.stdinPos++];
      const target=args[i];
      if(target.type!=='AddressOf') throw new Error('scanf() argument must be a pointer (&var)');
      const operand=target.operand;
      if(operand.type==='Identifier'){
        const ent=this.lookup(operand.name); if(!ent) throw new Error(`Undefined variable '${operand.name}'`);
        if(ent.type==='char') ent.value=raw[0];
        else if(ent.type==='float'||ent.type==='double') ent.value=parseFloat(raw);
        else ent.value=Math.trunc(parseFloat(raw));
      } else if(operand.type==='ArrayAccess'){
        const arr=this.evalExpr(operand.array); const idx=this.evalExpr(operand.index);
        arr[idx]=Math.trunc(parseFloat(raw));
      } else throw new Error('Unsupported scanf() target');
    }
    return 0;
  }
  snapshotVar(name,ent){
    let value=ent.value;
    if(Array.isArray(value)) value=value.map(v=>(v&&typeof v==='object')?{...v}:v);
    else if(value&&typeof value==='object') value={...value};
    return {name,type:ent.type,value,
      isPointer:ent.isPointer,isArray:ent.isArray,address:ent.address};
  }
  recordStep(line){
    if(this.callStack.length) this.callStack[this.callStack.length-1].activeLine=line;
    const cs=this.callStack.map(f=>({
      name:f.name,args:f.args,startLine:f.startLine,endLine:f.endLine,activeLine:f.activeLine,
      variables:Array.from(f.vars.entries()).map(([n,ent])=>this.snapshotVar(n,ent))
    }));
    const globals=Array.from(this.globals.entries()).map(([n,ent])=>this.snapshotVar(n,ent));
    const prev=this.steps[this.steps.length-1];
    const markChanged=(list,prevList)=>list.map(v=>{
      const p=prevList&&prevList.find(x=>x.name===v.name);
      const changed = p ? JSON.stringify(p.value)!==JSON.stringify(v.value) : true;
      let changedIndices=null, swapPair=null;
      if(v.isArray){
        if(p && Array.isArray(p.value)){
          changedIndices = v.value.map((val,idx)=> JSON.stringify(val)!==JSON.stringify(p.value[idx]));
          const diffIdxs=[];
          for(let idx=0;idx<changedIndices.length;idx++) if(changedIndices[idx]) diffIdxs.push(idx);
          const addr=v.address;
          if(diffIdxs.length===1){
            // Exactly one cell changed this step. Either this completes a swap that a
            // previous single-cell change was waiting on, or it starts a new pending one.
            const idx=diffIdxs[0];
            const oldVal=p.value[idx], newVal=v.value[idx];
            const pending=this.pendingSwap.get(addr);
            if(pending && pending.idx!==idx && newVal===pending.oldVal && pending.newVal===oldVal){
              swapPair=[pending.idx,idx].sort((a,b)=>a-b);
              this.pendingSwap.delete(addr);
            } else {
              this.pendingSwap.set(addr,{idx,oldVal,newVal});
            }
          } else if(diffIdxs.length>1){
            this.pendingSwap.delete(addr);
          }
        } else {
          changedIndices = v.value.map(()=>true);
        }
      }
      return {...v,changed,changedIndices,swapPair};
    });
    for(let i=0;i<cs.length;i++){
      const prevFrame = prev && prev.callStack[i] && prev.callStack[i].name===cs[i].name ? prev.callStack[i] : null;
      cs[i].variables = markChanged(cs[i].variables, prevFrame?prevFrame.variables:null);
    }
    const globalsMarked = markChanged(globals, prev?prev.globals:null);
    const heap=[];
    for(const [addr,ent] of this.addrMap.entries()) if(ent.heap) heap.push({address:addr,value:[...ent.value]});
    if(this.steps.length>0) this.steps[this.steps.length-1].nextLine = line;
    this.steps.push({line,output:this.output,callStack:cs,globals:globalsMarked,heap});
  }
}

function runCProgram(src, stdinText){
  const tokens=tokenize(src);
  const program=new Parser(tokens).parseProgram();
  const interp=new Interpreter();
  const steps=interp.run(program, stdinText);
  return steps;
}

/* ================================ UI ===================================== */
const $=id=>document.getElementById(id);
const codeInput=$('codeInput'), codeView=$('codeView'), outputView=$('outputView'),
      stdinInput=$('stdinInput'), errorBanner=$('errorBanner'),
      runBtn=$('runBtn'), stepBackBtn=$('stepBackBtn'), stepFwdBtn=$('stepFwdBtn'),
      playBtn=$('playBtn'), resetBtn=$('resetBtn'), speedSelect=$('speedSelect'),
      stepLabel=$('stepLabel'), stepSlider=$('stepSlider'), exampleSelect=$('exampleSelect'),
      emptyState=$('emptyState'), vizContent=$('vizContent'),
      callStackBody=$('callStackBody'), arraysBody=$('arraysBody'), globalsBody=$('globalsBody'),
      editorWrap=$('editorWrap'), codeHighlight=$('codeHighlight'), codeHighlightCode=$('codeHighlightCode'),
      codeGutter=$('codeGutter'), codeContent=$('codeContent');

let STEPS=[], CURRENT=-1, PLAYING=false, PLAY_TIMER=null;

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function highlightC(line){
  let out=esc(line);
  out=out.replace(/(\/\/.*$)/,'<span class="cm">$1</span>');
  out=out.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g,'<span class="str">$1</span>');
  out=out.replace(/\b(int|float|double|char|void|bool|const|struct)\b/g,'<span class="ty">$1</span>');
  out=out.replace(/\b(if|else|for|while|return|break|continue|true|false|sizeof|NULL)\b/g,'<span class="kw">$1</span>');
  out=out.replace(/\b(\d+\.?\d*)\b/g,'<span class="num">$1</span>');
  return out;
}

/* Live syntax highlighting for the editable code textarea (overlay technique) */
function updateEditorHighlight(){
  codeHighlightCode.innerHTML = codeInput.value.split('\n').map(highlightC).join('\n') + '\n';
  updateGutter();
}
/* Always-visible line-number gutter, kept in sync with the textarea's line count and scroll */
function updateGutter(){
  const lineCount = codeInput.value.split('\n').length;
  const cur = codeGutter.children.length;
  if(cur !== lineCount){
    let html='';
    for(let i=1;i<=lineCount;i++) html+=`<div class="gutter-line" data-ln="${i}">${i}</div>`;
    codeGutter.innerHTML = html;
  }
  codeGutter.scrollTop = codeInput.scrollTop;
}
function syncEditorScroll(){
  codeHighlight.scrollTop = codeInput.scrollTop;
  codeHighlight.scrollLeft = codeInput.scrollLeft;
  codeGutter.scrollTop = codeInput.scrollTop;
}

function renderCodeView(){
  const lines=codeInput.value.split('\n');
  const step=CURRENT>=0?STEPS[CURRENT]:null;
  const curLine=step?step.line:-1;
  const nextLine=step?step.nextLine:-1;
  let html='';
  for(let i=0;i<lines.length;i++){
    const ln=i+1;
    let cls='code-line';
    if(ln===curLine) cls+=' current-line';
    else if(ln===nextLine) cls+=' next-line';
    html+=`<div class="${cls}" data-ln="${ln}"><span class="ln">${ln}</span><span class="src">${highlightC(lines[i])||' '}</span></div>`;
  }
  codeView.innerHTML=html;
  const activeEl=codeView.querySelector('.current-line');
  if(activeEl) activeEl.scrollIntoView({block:'center',behavior:'smooth'});
}

function setEditingMode(editing){
  if(editing){ editorWrap.classList.remove('hidden'); codeView.classList.remove('active'); }
  else { editorWrap.classList.add('hidden'); codeView.classList.add('active'); }
}

function updateOutput(text){
  outputView.textContent = text || '';
  if(!text) outputView.innerHTML='<span class="placeholder">No output yet</span>';
}

function updateControls(){
  const has=STEPS.length>0;
  stepBackBtn.disabled = !has || CURRENT<=0;
  stepFwdBtn.disabled = !has || CURRENT>=STEPS.length-1;
  playBtn.disabled = !has || CURRENT>=STEPS.length-1;
  playBtn.textContent = PLAYING?'⏸':'▶';
  stepLabel.textContent = has ? `${CURRENT+1} / ${STEPS.length}` : '0 / 0';
  stepSlider.max = Math.max(has?STEPS.length-1:0,0);
  stepSlider.value = CURRENT>=0?CURRENT:0;
}

function renderVars(vars){
  if(!vars.length) return '<div class="novars">No local variables</div>';
  let rows='';
  for(const v of vars){
    if(v.isArray) continue; // arrays rendered separately
    const displayName = v.isPointer ? '* '+v.name : v.name;
    let displayVal, extraCls='';
    if(v.isPointer){ displayVal = v.value ? '→ 0x'+Number(v.value).toString(16) : 'nullptr'; }
    else if(v.value&&typeof v.value==='object'&&!Array.isArray(v.value)){
      extraCls=' struct-val';
      displayVal = '{ '+Object.entries(v.value).map(([k,val])=>`${k}: ${typeof val==='object'?'{…}':val}`).join(', ')+' }';
    }
    else if(typeof v.value==='number') displayVal = Number.isInteger(v.value)? v.value : v.value.toFixed(4);
    else displayVal = String(v.value);
    rows+=`<tr>
      <td class="${'vname'+(v.isPointer?' ptr':'')}">${esc(displayName)}</td>
      <td class="vtype">${esc(v.type)}</td>
      <td class="vval${v.changed?' changed':''}${extraCls}">${esc(String(displayVal))}</td>
    </tr>`;
  }
  if(!rows) return '<div class="novars">No scalar variables</div>';
  return `<table class="vars">${rows}</table>`;
}

function renderCallStack(step){
  if(!step.callStack.length){ callStackBody.innerHTML='<div class="novars">No active function calls</div>'; return; }
  let html='';
  const frames=[...step.callStack].reverse();
  frames.forEach((f,i)=>{
    const isTop = i===0;
    html+=`<div class="frame-card${isTop?' top':''}">
      <div class="frame-head">
        <span class="fname">${isTop?'<span class="pulse"></span>':''}${esc(f.name)}(${f.args.map(a=>Array.isArray(a)?'[...]':a).join(', ')})</span>
        <span style="color:var(--muted);font-weight:500;">line ${f.activeLine}</span>
      </div>
      ${renderVars(f.variables)}
    </div>`;
  });
  callStackBody.innerHTML=html;
}

function fmtVal(v){
  if(typeof v==='number') return String(Number.isInteger(v)?v:v.toFixed(2));
  if(v&&typeof v==='object') return '{'+Object.values(v).map(x=>typeof x==='object'?'…':x).join(',')+'}';
  return String(v);
}

function renderArrays(step){
  const allArrays=[];
  for(const f of step.callStack) for(const v of f.variables) if(v.isArray) allArrays.push({...v,scope:f.name});
  for(const v of step.globals) if(v.isArray) allArrays.push({...v,scope:'global'});
  const heapByAddr=new Map((step.heap||[]).map(h=>[h.address,h.value]));
  const addHeapPointers=(vars,scope)=>{
    for(const v of vars){
      if(!v.isArray && v.isPointer && typeof v.value==='number' && heapByAddr.has(v.value)){
        allArrays.push({name:v.name,type:v.type+' (heap)',value:heapByAddr.get(v.value),scope,changed:false,changedIndices:null,swapPair:null});
      }
    }
  };
  for(const f of step.callStack) addHeapPointers(f.variables,f.name);
  addHeapPointers(step.globals,'global');
  if(!allArrays.length){ arraysBody.innerHTML='<div class="novars">No arrays in scope</div>'; return; }
  let html='';
  for(const a of allArrays){
    const swapAttr = a.swapPair ? ` data-swap="${a.swapPair[0]},${a.swapPair[1]}"` : '';
    html+=`<div class="array-block"${swapAttr}>
      <div class="array-label">${esc(a.type)} <b>${esc(a.name)}</b>[${a.value.length}] <span style="color:var(--muted-2)">(${esc(a.scope)})</span></div>
      <div class="array-cells">${a.value.map((val,idx)=>{
        const isSwap = a.swapPair && (idx===a.swapPair[0]||idx===a.swapPair[1]);
        const cls = isSwap ? ' swap-cell' : (a.changedIndices && a.changedIndices[idx] ? ' changed' : '');
        return `
        <div class="cell${cls}">
          <div class="box">${esc(fmtVal(val))}</div>
          <div class="idx">${idx}</div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }
  arraysBody.innerHTML=html;
  attachSwapArrows();
}

/* Draws a curved, arrow-tipped SVG connector above each pair of cells that just swapped,
   and triggers a one-shot pulse animation on those two cells. */
function attachSwapArrows(){
  const svgNS='http://www.w3.org/2000/svg';
  const blocks=arraysBody.querySelectorAll('.array-block[data-swap]');
  blocks.forEach(block=>{
    const [i,j]=block.dataset.swap.split(',').map(Number);
    const cellsWrap=block.querySelector('.array-cells');
    const cells=cellsWrap.querySelectorAll('.cell');
    const c1=cells[i], c2=cells[j];
    if(!c1||!c2) return;
    const r1=c1.getBoundingClientRect(), r2=c2.getBoundingClientRect(), rc=cellsWrap.getBoundingClientRect();
    if(Math.abs(r1.top-r2.top)>2) return; // cells wrapped to different rows; skip the arc
    const x1=r1.left-rc.left+r1.width/2, x2=r2.left-rc.left+r2.width/2;
    const svgW=Math.max(cellsWrap.offsetWidth,x2+20), svgH=24;
    const midX=(x1+x2)/2;
    const svg=document.createElementNS(svgNS,'svg');
    svg.setAttribute('class','swap-arrow-layer');
    svg.setAttribute('width',svgW);
    svg.setAttribute('height',svgH);
    svg.setAttribute('viewBox',`0 0 ${svgW} ${svgH}`);
    const arc=document.createElementNS(svgNS,'path');
    arc.setAttribute('d',`M ${x1} ${svgH-2} Q ${midX} 0 ${x2} ${svgH-2}`);
    arc.setAttribute('class','swap-arc');
    svg.appendChild(arc);
    [x1,x2].forEach(x=>{
      const head=document.createElementNS(svgNS,'path');
      head.setAttribute('d',`M ${x-4} ${svgH-9} L ${x+4} ${svgH-9} L ${x} ${svgH-1} Z`);
      head.setAttribute('class','swap-arrowhead');
      svg.appendChild(head);
    });
    block.classList.add('has-swap-arrow');
    block.insertBefore(svg, cellsWrap);
    [c1,c2].forEach(c=>{
      const box=c.querySelector('.box');
      box.classList.remove('swap-pulse'); void box.offsetWidth; box.classList.add('swap-pulse');
    });
  });
}

function renderGlobals(step){
  const scalars=step.globals.filter(v=>!v.isArray);
  globalsBody.innerHTML = scalars.length ? renderVars(scalars) : '<div class="novars">No global scalars</div>';
  $('globalsSection').style.display = step.globals.length ? '' : 'none';
}

function renderStep(){
  if(CURRENT<0 || !STEPS.length){
    emptyState.style.display='flex'; vizContent.style.display='none';
    updateOutput(''); renderCodeView(); updateControls();
    return;
  }
  emptyState.style.display='none'; vizContent.style.display='block';
  const step=STEPS[CURRENT];
  updateOutput(step.output);
  renderCallStack(step);
  renderArrays(step);
  renderGlobals(step);
  renderCodeView();
  updateControls();
}

function showError(msg){
  if(msg){ errorBanner.textContent='⚠ '+msg; errorBanner.classList.add('show'); }
  else{ errorBanner.classList.remove('show'); errorBanner.textContent=''; }
}

function doRun(){
  pausePlay();
  showError(null);
  try{
    STEPS = runCProgram(codeInput.value, stdinInput.value);
    CURRENT = STEPS.length ? 0 : -1;
    setEditingMode(false);
  }catch(err){
    STEPS=[]; CURRENT=-1;
    setEditingMode(true);
    showError(err.message);
  }
  renderStep();
}

function doReset(){
  pausePlay();
  STEPS=[]; CURRENT=-1;
  setEditingMode(true);
  showError(null);
  renderStep();
}

function pausePlay(){
  PLAYING=false;
  if(PLAY_TIMER){clearInterval(PLAY_TIMER);PLAY_TIMER=null;}
  updateControls();
}

function startPlay(){
  if(!STEPS.length || CURRENT>=STEPS.length-1) return;
  PLAYING=true; updateControls();
  const speed=parseInt(speedSelect.value,10);
  PLAY_TIMER=setInterval(()=>{
    if(CURRENT>=STEPS.length-1){pausePlay();return;}
    CURRENT++; renderStep();
    if(CURRENT>=STEPS.length-1) pausePlay();
  }, speed);
}

runBtn.addEventListener('click', doRun);
resetBtn.addEventListener('click', doReset);
stepFwdBtn.addEventListener('click', ()=>{ if(CURRENT<STEPS.length-1){CURRENT++; pausePlay(); renderStep();} });
stepBackBtn.addEventListener('click', ()=>{ if(CURRENT>0){CURRENT--; pausePlay(); renderStep();} });
playBtn.addEventListener('click', ()=>{ PLAYING?pausePlay():startPlay(); });
stepSlider.addEventListener('input', ()=>{ CURRENT=parseInt(stepSlider.value,10); pausePlay(); renderStep(); });
function updateGutterActiveLine(){
  const line = codeInput.value.slice(0,codeInput.selectionStart).split('\n').length;
  const prevActive=codeGutter.querySelector('.active-line');
  if(prevActive) prevActive.classList.remove('active-line');
  const el=codeGutter.querySelector(`[data-ln="${line}"]`);
  if(el) el.classList.add('active-line');
}
codeInput.addEventListener('input', ()=>{ updateEditorHighlight(); updateGutterActiveLine(); if(STEPS.length){doReset();} });
codeInput.addEventListener('scroll', syncEditorScroll);
codeInput.addEventListener('click', updateGutterActiveLine);
codeInput.addEventListener('keyup', updateGutterActiveLine);
codeInput.addEventListener('keydown', e=>{
  if(e.key==='Tab'){ e.preventDefault();
    const s=codeInput.selectionStart, en=codeInput.selectionEnd;
    codeInput.value = codeInput.value.slice(0,s)+'    '+codeInput.value.slice(en);
    codeInput.selectionStart=codeInput.selectionEnd=s+4;
    updateEditorHighlight();
  }
});

/* -------------------------- Help modal -------------------------- */
const FEATURES = [
  'Variables: int, float, double, char, bool, const',
  'Arithmetic, comparison, logical & compound-assignment operators',
  'if / else, for, while, break, continue',
  'Functions, parameters, return values & recursion',
  'Arrays (1D), array literals, indexing',
  'Pointers: &, *, pointer-to-pointer, pass-by-reference',
  'structs: definitions, dot (.) and arrow (->) member access, arrays of structs',
  'Dynamic memory: malloc, calloc, realloc, free, sizeof',
  'Simulated file I/O: fopen, fclose, fprintf, fputs, fscanf (in-memory virtual files)',
  'printf / scanf with %d %f %c %s specifiers',
  'Global variables',
  'Always-visible line numbers, step-by-step execution & call stack view'
];
const LIMITATIONS = [
  'No 2D/multi-dimensional arrays yet',
  'No unions, enums, typedef, or function pointers',
  'No preprocessor macros beyond #include (ignored)',
  'Pointer arithmetic (p + i) is not evaluated — use p[i] indexing instead',
  'File I/O is fully simulated in-browser; no real disk access',
  'fgets / fgetc are not yet supported',
  'Standard library beyond printf/scanf/malloc family/file I/O is not implemented'
];
const TIPS = [
  'Click "Run" to execute, then use the step controls or Play to walk through execution line by line',
  'Use the example dropdown to load ready-made programs for every topic, including structs, pointers, malloc and file handling',
  'Hover the Arrays panel to see heap memory allocated by malloc/calloc/realloc',
  'Provide input for scanf() in the stdin box before running'
];
function fillList(id, items){ $(id).innerHTML = items.map(t=>`<li>${t}</li>`).join(''); }
fillList('featuresList', FEATURES);
fillList('limitationsList', LIMITATIONS);
fillList('tipsList', TIPS);

$('helpBtn').addEventListener('click', ()=>$('helpOverlay').classList.add('show'));
$('helpClose').addEventListener('click', ()=>$('helpOverlay').classList.remove('show'));
$('helpOverlay').addEventListener('click', e=>{ if(e.target.id==='helpOverlay') $('helpOverlay').classList.remove('show'); });

/* ---------------------------- Examples ---------------------------------- */
const EXAMPLES = [
{group:'Basics', items:[
{name:'Variables & Arithmetic', code:
`#include <stdio.h>

int main() {
    int a = 5;
    int b = 3;
    int sum = a + b;
    int product = a * b;
    printf("Sum: %d\\n", sum);
    printf("Product: %d\\n", product);
    return 0;
}`},
{name:'Input (scanf)', code:
`#include <stdio.h>

int factorial(int n) {
    int ans = 1;
    for (int i = 2; i <= n; i++) {
        ans = ans * i;
    }
    return ans;
}

int main() {
    int num;
    scanf("%d", &num);
    printf("%d\\n", factorial(num));
    return 0;
}`, stdin:'5'},
{name:'If/Else & Loops', code:
`#include <stdio.h>

int main() {
    int n = 10;
    int sum = 0;
    for (int i = 1; i <= n; i++) {
        sum += i;
    }
    if (sum > 50) {
        printf("Sum is large: %d\\n", sum);
    } else {
        printf("Sum is small: %d\\n", sum);
    }
    return 0;
}`},
{name:'Factorial (Recursion)', code:
`#include <stdio.h>

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    int result = n * factorial(n - 1);
    return result;
}

int main() {
    int num = 5;
    int result = factorial(num);
    printf("%d! = %d\\n", num, result);
    return 0;
}`},
{name:'Fibonacci', code:
`#include <stdio.h>

int fibonacci(int n) {
    if (n <= 0) return 0;
    if (n == 1) return 1;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

int main() {
    for (int i = 0; i < 7; i++) {
        printf("%d ", fibonacci(i));
    }
    printf("\\n");
    return 0;
}`}
]},
{group:'Sorting', items:[
{name:'Bubble Sort', code:
`#include <stdio.h>

int main() {
    int arr[5] = {5, 3, 8, 1, 2};
    int n = 5;
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }
    for (int i = 0; i < n; i++) printf("%d ", arr[i]);
    printf("\\n");
    return 0;
}`},
{name:'Selection Sort', code:
`#include <stdio.h>

int main() {
    int arr[6] = {64, 25, 12, 22, 11, 1};
    int n = 6;
    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;
        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIdx]) minIdx = j;
        }
        int temp = arr[minIdx];
        arr[minIdx] = arr[i];
        arr[i] = temp;
    }
    for (int i = 0; i < n; i++) printf("%d ", arr[i]);
    printf("\\n");
    return 0;
}`},
{name:'Insertion Sort', code:
`#include <stdio.h>

int main() {
    int arr[6] = {12, 11, 13, 5, 6, 7};
    int n = 6;
    for (int i = 1; i < n; i++) {
        int key = arr[i];
        int j = i - 1;
        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = key;
    }
    for (int i = 0; i < n; i++) printf("%d ", arr[i]);
    printf("\\n");
    return 0;
}`}
]},
{group:'Searching', items:[
{name:'Binary Search', code:
`#include <stdio.h>

int main() {
    int arr[8] = {2, 5, 8, 12, 16, 23, 38, 56};
    int target = 23;
    int left = 0, right = 7, result = -1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] == target) { result = mid; break; }
        if (arr[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    if (result != -1) printf("Found at index %d\\n", result);
    else printf("Not found\\n");
    return 0;
}`},
{name:'Linear Search', code:
`#include <stdio.h>

int main() {
    int arr[6] = {4, 2, 7, 1, 9, 3};
    int target = 7;
    int found = -1;
    for (int i = 0; i < 6; i++) {
        if (arr[i] == target) found = i;
    }
    if (found != -1) printf("Found %d at index %d\\n", target, found);
    else printf("Not found\\n");
    return 0;
}`}
]},
{group:'Classic Algorithms', items:[
{name:'Two Sum', code:
`#include <stdio.h>

int main() {
    int arr[5] = {2, 7, 11, 15, 1};
    int target = 9;
    int n = 5;
    int found1 = -1, found2 = -1;
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            if (arr[i] + arr[j] == target) { found1 = i; found2 = j; }
        }
    }
    if (found1 != -1) printf("Indices: %d, %d\\n", found1, found2);
    return 0;
}`},
{name:'Reverse Array', code:
`#include <stdio.h>

int main() {
    int arr[6] = {1, 2, 3, 4, 5, 6};
    int n = 6;
    int left = 0, right = n - 1;
    while (left < right) {
        int temp = arr[left];
        arr[left] = arr[right];
        arr[right] = temp;
        left++; right--;
    }
    for (int i = 0; i < n; i++) printf("%d ", arr[i]);
    printf("\\n");
    return 0;
}`},
{name:'GCD (Euclidean)', code:
`#include <stdio.h>

int gcd(int a, int b) {
    if (b == 0) return a;
    return gcd(b, a % b);
}

int main() {
    int a = 48, b = 18;
    int result = gcd(a, b);
    printf("GCD of %d and %d is %d\\n", a, b, result);
    return 0;
}`},
{name:'Power (Recursion)', code:
`#include <stdio.h>

int power(int base, int exp) {
    if (exp == 0) return 1;
    int half = power(base, exp / 2);
    if (exp % 2 == 0) return half * half;
    return base * half * half;
}

int main() {
    int b = 2, e = 10;
    printf("%d^%d = %d\\n", b, e, power(b, e));
    return 0;
}`}
]},
{group:'Pointers & Globals', items:[
{name:'Pointers Basics', code:
`#include <stdio.h>

int main() {
    int x = 42;
    int* ptr = &x;
    printf("Value: %d\\n", x);
    printf("Pointer: %d\\n", *ptr);
    *ptr = 100;
    printf("Modified: %d\\n", x);
    return 0;
}`},
{name:'Swap via Pointers', code:
`#include <stdio.h>

void swap(int* a, int* b) {
    int temp = *a;
    *a = *b;
    *b = temp;
}

int main() {
    int x = 5, y = 10;
    printf("Before: x=%d y=%d\\n", x, y);
    swap(&x, &y);
    printf("After: x=%d y=%d\\n", x, y);
    return 0;
}`},
{name:'Global Variables', code:
`#include <stdio.h>

int counter = 0;
int total = 100;

void increment() {
    counter = counter + 1;
}

int main() {
    for (int i = 0; i < 5; i++) {
        increment();
    }
    printf("Counter: %d, Total: %d\\n", counter, total);
    return 0;
}`},
{name:'Two Inputs', code:
`#include <stdio.h>

int main() {
    int a, b;
    scanf("%d", &a);
    scanf("%d", &b);
    printf("Sum: %d\\n", a + b);
    printf("Difference: %d\\n", a - b);
    return 0;
}`, stdin:'10\n3'},
{name:'Pointer to Pointer', code:
`#include <stdio.h>

int main() {
    int x = 10;
    int* p = &x;
    int** pp = &p;
    printf("x = %d\\n", x);
    printf("*p = %d\\n", *p);
    printf("**pp = %d\\n", **pp);
    **pp = 99;
    printf("x after **pp = 99 -> %d\\n", x);
    return 0;
}`},
{name:'Array as Pointer', code:
`#include <stdio.h>

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    int* p = arr;
    for (int i = 0; i < 5; i++) {
        printf("%d ", p[i]);
    }
    printf("\\n");
    p[0] = 999;
    printf("arr[0] after p[0]=999 -> %d\\n", arr[0]);
    return 0;
}`}
]},
{group:'Structs', items:[
{name:'Struct Basics', code:
`#include <stdio.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point p;
    p.x = 3;
    p.y = 4;
    printf("Point(%d, %d)\\n", p.x, p.y);
    return 0;
}`},
{name:'Struct Initialization', code:
`#include <stdio.h>

struct Student {
    int id;
    int marks;
};

int main() {
    struct Student s = {101, 87};
    printf("ID: %d, Marks: %d\\n", s.id, s.marks);
    s.marks = s.marks + 5;
    printf("Updated Marks: %d\\n", s.marks);
    return 0;
}`},
{name:'Struct Pointer (->)', code:
`#include <stdio.h>

struct Point {
    int x;
    int y;
};

void move(struct Point* p, int dx, int dy) {
    p->x = p->x + dx;
    p->y = p->y + dy;
}

int main() {
    struct Point p = {1, 2};
    struct Point* ptr = &p;
    printf("Before: (%d, %d)\\n", ptr->x, ptr->y);
    move(ptr, 5, 5);
    printf("After: (%d, %d)\\n", p.x, p.y);
    return 0;
}`},
{name:'Array of Structs', code:
`#include <stdio.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point pts[3];
    for (int i = 0; i < 3; i++) {
        pts[i].x = i;
        pts[i].y = i * i;
    }
    for (int i = 0; i < 3; i++) {
        printf("(%d, %d) ", pts[i].x, pts[i].y);
    }
    printf("\\n");
    return 0;
}`},
{name:'Nested Structs', code:
`#include <stdio.h>

struct Point {
    int x;
    int y;
};

struct Rectangle {
    struct Point topLeft;
    int width;
    int height;
};

int main() {
    struct Rectangle r;
    r.topLeft.x = 0;
    r.topLeft.y = 0;
    r.width = 10;
    r.height = 5;
    printf("Rect at (%d,%d) size %dx%d\\n", r.topLeft.x, r.topLeft.y, r.width, r.height);
    return 0;
}`}
]},
{group:'Dynamic Memory (malloc / calloc / realloc)', items:[
{name:'malloc Basics', code:
`#include <stdio.h>
#include <stdlib.h>

int main() {
    int n = 5;
    int* arr = malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) {
        arr[i] = i * i;
    }
    for (int i = 0; i < n; i++) {
        printf("%d ", arr[i]);
    }
    printf("\\n");
    free(arr);
    return 0;
}`},
{name:'calloc (zero-initialized)', code:
`#include <stdio.h>
#include <stdlib.h>

int main() {
    int n = 5;
    int* arr = calloc(n, sizeof(int));
    printf("Before: ");
    for (int i = 0; i < n; i++) printf("%d ", arr[i]);
    printf("\\n");
    for (int i = 0; i < n; i++) arr[i] = i + 1;
    printf("After: ");
    for (int i = 0; i < n; i++) printf("%d ", arr[i]);
    printf("\\n");
    free(arr);
    return 0;
}`},
{name:'realloc (grow array)', code:
`#include <stdio.h>
#include <stdlib.h>

int main() {
    int n = 3;
    int* arr = malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) arr[i] = i + 1;

    int newN = 6;
    arr = realloc(arr, newN * sizeof(int));
    for (int i = n; i < newN; i++) arr[i] = i + 1;

    for (int i = 0; i < newN; i++) printf("%d ", arr[i]);
    printf("\\n");
    free(arr);
    return 0;
}`},
{name:'Dynamic Struct (malloc)', code:
`#include <stdio.h>
#include <stdlib.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point* p = malloc(sizeof(struct Point));
    p->x = 7;
    p->y = 9;
    printf("Point(%d, %d)\\n", p->x, p->y);
    free(p);
    return 0;
}`}
]},
{group:'File Handling', items:[
{name:'Write to File', code:
`#include <stdio.h>

int main() {
    FILE* fp = fopen("data.txt", "w");
    fprintf(fp, "%d %d %d\\n", 10, 20, 30);
    fprintf(fp, "Hello File\\n");
    fclose(fp);
    printf("Data written to data.txt\\n");
    return 0;
}`},
{name:'Write then Read Back', code:
`#include <stdio.h>

int main() {
    FILE* out = fopen("numbers.txt", "w");
    for (int i = 1; i <= 5; i++) {
        fprintf(out, "%d ", i * 10);
    }
    fclose(out);

    FILE* in = fopen("numbers.txt", "r");
    int sum = 0;
    int val;
    while (fscanf(in, "%d", &val) == 1) {
        sum = sum + val;
    }
    fclose(in);
    printf("Sum from file: %d\\n", sum);
    return 0;
}`}
]}
];

function initExamples(){
  for(const grp of EXAMPLES){
    const og=document.createElement('optgroup'); og.label=grp.group;
    for(const item of grp.items){
      const opt=document.createElement('option'); opt.value=item.name; opt.textContent=item.name;
      og.appendChild(opt);
    }
    exampleSelect.appendChild(og);
  }
  const placeholder=document.createElement('option');
  placeholder.value=''; placeholder.textContent='Load an example…'; placeholder.selected=true;
  exampleSelect.insertBefore(placeholder, exampleSelect.firstChild);
}
function findExample(name){
  for(const grp of EXAMPLES) for(const it of grp.items) if(it.name===name) return it;
  return null;
}
exampleSelect.addEventListener('change', ()=>{
  const ex=findExample(exampleSelect.value);
  if(!ex) return;
  codeInput.value=ex.code;
  stdinInput.value=ex.stdin||'';
  updateEditorHighlight();
  doReset();
});

/* ------------------------------- Init ------------------------------------ */
initExamples();
codeInput.value = findExample('Factorial (Recursion)').code;
updateEditorHighlight();
setEditingMode(true);
renderStep();
