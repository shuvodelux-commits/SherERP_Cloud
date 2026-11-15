/** M03/M04 local D1 test Worker: always 404, never a public Settings RPC. */
export default {
  fetch(){
    return Response.json({error:'Not found'},{status:404});
  }
};
