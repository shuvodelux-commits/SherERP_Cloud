/** Test-only M08 Worker. No callable financial route, always 404. */
export default {
  async fetch(){
    return Response.json({error:'Not found'},{
      status:404,headers:{'Cache-Control':'no-store'}
    });
  }
};
