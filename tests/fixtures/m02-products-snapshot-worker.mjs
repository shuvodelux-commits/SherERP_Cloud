// Isolated nonpublic Workerd harness: all HTTP routes fail closed.
export default {fetch(){return new Response('Not found',{status:404});}};
