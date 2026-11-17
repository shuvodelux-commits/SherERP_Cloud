// M01-only source-preserving Playwright viewport cycle, synthetic input only.
// A single logged-in browser page moves through these stages without reload.
// This file creates no transactions, real users, RPC grants or source changes.
export const M01_RESPONSIVE_VIEWPORT_STAGES=Object.freeze([
  Object.freeze({
    name:'phone-portrait-375x812',width:375,height:812,isPhone:true,tab:'customer'
  }),
  Object.freeze({
    name:'coarse-landscape-812x375',width:812,height:375,isPhone:true
  }),
  Object.freeze({
    name:'touch-tablet-768x1024',width:768,height:1024,isPhone:false
  }),
  Object.freeze({
    name:'compact-phone-320x640',width:320,height:640,isPhone:true,tab:'cart'
  })
]);
