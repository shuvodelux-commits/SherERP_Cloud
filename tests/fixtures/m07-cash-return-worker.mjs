// No test route: the fixture is never a public posting endpoint.
export default {fetch() {return new Response('Not Found',{status:404});}};
