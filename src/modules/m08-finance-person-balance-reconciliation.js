/**
 * M08 internal read-only reconciliation of original Finance Person IDs to
 * three independent finance accounts and six non-netted gross buckets.
 *
 * Original source: FinanceModule.gs:financePersonBalancesForUI_,
 * financeBalanceSummary_ and getFinanceBootstrap, pinned to
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * This has no D1, RPC, import, name/phone linking or financial write path.
 */
import {projectFinancePersonDirectory} from './m08-finance-person-directory.js';
import {projectFinanceRoleBalances} from './m08-finance-role-balances.js';

/**
 * Both inputs must be preloaded, source-shaped and active-filtered where
 * applicable. A missing/ambiguous original ID must be manually reviewed:
 * never invent an identity or silently omit a transaction from the totals.
 */
export function reconcileFinancePersonBalances(masterRows,activeFinanceRows) {
  const persons=projectFinancePersonDirectory(masterRows);
  const masterIds=new Set();
  for(const person of persons) {
    if(person.id.trim()!==person.id)
      throw new TypeError('Noncanonical original Finance Person ID');
    masterIds.add(person.id);
  }

  // The merged source-parity projection enforces active rows, known finance
  // transaction types, nonnegative finite amounts and original Person IDs.
  const {byPerson,summary}=projectFinanceRoleBalances(activeFinanceRows);
  for(const row of activeFinanceRows) {
    const id=row['Person ID'];
    if(id.trim()!==id || !masterIds.has(id))
      throw new TypeError('Unresolved finance transaction Person ID needs review');
  }

  const personBalances=Object.fromEntries(persons.map(person=>{
    const b=byPerson['id:'+person.id];
    return [person.id,{
      owner:b?.owner??0,
      loanPayable:b?.loanPayable??0,
      borrowerReceivable:b?.borrowerReceivable??0
    }];
  }));
  return {persons,personBalances,summary};
}
