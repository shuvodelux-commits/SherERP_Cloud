// Nondeployable local-only fixture; no public import or audit mutation route.
export default {fetch(){return new Response('Not found',{status:404});}};
