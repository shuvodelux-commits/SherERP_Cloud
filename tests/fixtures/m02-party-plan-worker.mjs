// Nondeployable source-shape harness: intentionally exposes no endpoints.
export default {
  fetch() {
    return new Response('Not Found', {status:404});
  }
};