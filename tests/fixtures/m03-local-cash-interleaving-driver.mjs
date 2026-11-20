/**
 * M03 Run 6 — nondeployable local D1 interleaving fixture.
 *
 * Interposes ONE real D1 mutation after module JS preflight, immediately
 * before the selected actual D1 statement. Every SQL statement including
 * the protected INSERT executes against the real disposable Workerd D1.
 * This is neither a mock cash writer nor a deployable DB adapter.
 */
export function createLocalD1Interleaver(DB,{statementPrefix,beforeExecute}={}){
  if(!DB||typeof DB.prepare!=='function'||
     statementPrefix!=='INSERT INTO m03_local_cash_intents'||
     typeof beforeExecute!=='function')
    throw new TypeError('Trusted M03 local D1 interleaving fixtures required');

  let count=0;
  const wrapped=Object.freeze({
    prepare(sql){
      const stmt=DB.prepare(sql);
      if(typeof sql!=='string'||!sql.trimStart().startsWith(statementPrefix))
        return stmt;
      return {
        bind(...args){
          const prepared=stmt.bind(...args);
          return {
            async run(){
              if(count===0){
                count++;
                await beforeExecute();
              }
              return prepared.run();
            }
          };
        }
      };
    }
  });
  return Object.freeze({db:wrapped,calls:()=>count});
}
