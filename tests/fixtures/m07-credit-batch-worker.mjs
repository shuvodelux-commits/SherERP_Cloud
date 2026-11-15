// No deployed Store Credit batch route. Synthetic Workerd test returns 404.
export default {fetch(){return new Response('Not Found',{status:404});}};
