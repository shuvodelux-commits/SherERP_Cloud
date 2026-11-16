import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectPostedSaleInvoice} from '../src/modules/sale-invoice-read-model.js';

function invoice(date,terms=5){
  return projectPostedSaleInvoice('INV-DATE-01',{
    sales:[{
      'Invoice ID':'INV-DATE-01','Date':date,'Time':'09:00:00',
      'Customer ID':'','Paid Amount':100,'Due Amount':0,
      'Grand Total':100,'Subtotal':100,'Discount':0,
      'Payment Detail Version':'','Payment Method':'Cash','Payment Type':'Cash',
      'Payment Status':'Paid','Is Deleted':'FALSE'
    }],
    items:[],products:[],customers:[],paymentRows:[],
    settings:{'Invoice Payment Terms Days':terms},shop:{name:'Shop'}
  });
}

test('invalid Gregorian invoice dates fail closed instead of rolling over to a fabricated due date',()=>{
  for(const date of [
    '2026-02-29','2026-02-31','2026-04-31',
    '2026-13-01','2026-00-10','2026-11-00',
    '2026-02-31T10:45:00','2026-02-31T00:00:00+06:00'
  ]){
    assert.throws(()=>invoice(date),/Invalid canonical posted-invoice date/,date);
  }
});

test('valid leap day, year-end rollover and canonical ISO timestamp retain due-date projection',()=>{
  assert.deepEqual(
    (({date,dueDate})=>({date,dueDate}))(invoice('2024-02-29')),
    {date:'2024-02-29',dueDate:'2024-03-05'}
  );
  assert.equal(invoice('2026-12-30',5).dueDate,'2027-01-04');
  assert.equal(invoice('2026-11-15T10:45:00',5).date,'2026-11-15');
  assert.equal(invoice('2026-11-15',0).dueDate,'');
});
