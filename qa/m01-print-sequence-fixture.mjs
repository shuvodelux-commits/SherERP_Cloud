// Synthetic M01-only invoice payload for repeated print-dialog browser QA.
// No real customer, Party ID, stock, transaction, phone or payment is used.
export function makeM01PrintSequenceInvoice(){
  return {
    invoiceId:'M01-PRINT-SEQUENCE',
    date:'2026-11-17',
    customerName:'M01 Synthetic Buyer',
    customerPhone:'',
    items:[{
      name:'M01 Synthetic Copper Cable',
      qty:1,
      unit:'pcs',
      unitPrice:50,
      lineTotal:50
    }],
    subtotal:50,
    discount:0,
    grandTotal:50,
    paidAmount:50,
    dueAmount:0,
    customerCreditUsed:0,
    paymentMethod:'Cash',
    payments:[],
    isDraft:false,
    shop:{
      name:'M01 Synthetic Hardware',
      nameBangla:'',
      address:'M01 Test-Only Street',
      phone1:'',
      phone2:'',
      currencySymbol:'৳',
      receiptSize:'A4',
      showBismillah:false,
      showSignature:false,
      footer:'Synthetic browser QA; not a financial invoice',
      paymentMethods:'[]',
      terms:'[]'
    }
  };
}
