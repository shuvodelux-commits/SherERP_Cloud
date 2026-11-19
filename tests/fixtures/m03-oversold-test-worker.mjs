/** Local Workerd test harness only. No public RPC or user-data binding. */
export default {fetch(){return Response.json({error:'Not found'},{status:404});}};
