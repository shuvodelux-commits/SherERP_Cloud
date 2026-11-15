/** Synthetic M04 session fixture; never deployed and no public login handlers. */
export default {fetch(){return new Response('Not found',{status:404});}};
