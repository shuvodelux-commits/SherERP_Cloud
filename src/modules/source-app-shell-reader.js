import {createSettingsReadAdapter} from '../db/settings-read.js';

/**
 * Internal M03/M09 source-shaped app shell read; NOT registered on public RPC.
 * NAV_ITEMS declaration below is copied verbatim from frozen UI.gs.
 * Navigation is presentation only and never a permission grant.
 */
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard',     icon: 'dashboard', bn: 'আজকের অবস্থা', sidebarGroup: 0, sidebarOrder: 10 },
  {
    key: 'pos', label: 'POS', icon: 'pos', bn: 'ক্যাশ কাউন্টার', sidebarGroup: 0, sidebarOrder: 20, landingKey: 'posv2',
    // POS V2 is the only user-facing POS route. The shared operational
    // runtime still lives in pos.html; Classic is intentionally not exposed.
    children: [
      { key: 'posv2', label: 'POS V2', bn: 'SherHisab ডিজাইন', permKey: 'pos' }
    ]
  },
  { key: 'counter',   label: 'Counter',       icon: 'counter',   bn: 'দ্রুত লেনদেন', sidebarGroup: 0, sidebarOrder: 25, actionPermAny: [
    { module: 'customers', action: 'edit' },
    { module: 'suppliers', action: 'edit' },
    { module: 'expense', action: 'add' },
    { module: 'bank', action: 'add' }
  ] },
  {
    key: 'sales', label: 'Sales', icon: 'sales', bn: 'বিক্রি', sidebarGroup: 1, sidebarOrder: 30,
    children: [
      { key: 'sales',         label: 'Sales Invoice', bn: 'বিক্রির রশিদ' },
      { key: 'draftSales', label: 'Draft Invoices', bn: 'খসড়া বিক্রি', actionPermAny: [
        { module: 'pos', action: 'add' },
        { module: 'sales', action: 'edit' }
      ] },
      { key: 'returns',       label: 'New Return',    bn: 'বিক্রি ফেরত' },
      // Rides on the 'returns' permission (not its own PERMISSION_MODULES
      // entry) via permKey — New Return and Return History are the same
      // right ("may process a refund"), just two separate pages now instead
      // of one page with an internal tab strip. See subNavVisible_.
      { key: 'returnHistory', label: 'Return History', bn: 'আগের ফেরতের তালিকা', permKey: 'returns' }
    ]
  },
  { key: 'purchase',  label: 'Purchases',     icon: 'purchase',  bn: 'কেনা', sidebarGroup: 2, sidebarOrder: 50 },
  {
    key: 'suppliers', label: 'Suppliers', icon: 'suppliers', bn: 'সাপ্লায়ার ও বাকি', sidebarGroup: 2, sidebarOrder: 60,
    children: [
      { key: 'suppliers', label: 'Suppliers', bn: 'সাপ্লায়ার তালিকা' },
      { key: 'supplierLedger', label: 'Supplier Ledger', bn: 'সাপ্লায়ার খতিয়ান', permKey: 'suppliers' }
    ]
  },
  // Vendor is a grouped workspace: the existing ledger/manage list plus
  // a dedicated transaction workspace. Both ride on the same 'vendors'
  // permission module; vendorWorkspace is presentation only.
  {
    key: 'vendors', label: 'Vendor', icon: 'vendors', bn: 'ভেন্ডর', sidebarGroup: 2, sidebarOrder: 70,
    children: [
      { key: 'vendors', label: 'Vendor Ledger', bn: 'ভেন্ডরের হিসাব' },
      { key: 'vendorWorkspace', label: 'Vendor Workspace', bn: 'ভেন্ডরের কাজ', permKey: 'vendors' }
    ]
  },
  { key: 'products',  label: 'Products',      icon: 'products',  bn: 'পণ্য ও স্টক', sidebarGroup: 1, sidebarOrder: 45 },
  {
    key: 'customers', label: 'Customers', icon: 'customers', bn: 'কাস্টমার ও বাকি', sidebarGroup: 1, sidebarOrder: 40,
    children: [
      { key: 'customers', label: 'Customers', bn: 'কাস্টমার তালিকা' },
      { key: 'customerLedger', label: 'Customer Ledger', bn: 'কাস্টমার খতিয়ান', permKey: 'customers' }
    ]
  },
  { key: 'bank',      label: 'Bank Accounts', icon: 'bank',      bn: 'ব্যাংকের হিসাব', sidebarGroup: 4, sidebarOrder: 100 },
  {
    key: 'expense', label: 'Expenses', icon: 'expense', bn: 'খরচ', sidebarGroup: 4, sidebarOrder: 110,
    // One native tab strip for the approved Expense module; all use the
    // existing expense view permission and existing authorized write APIs.
    children: [
      { key: 'expenseReports',     label: 'Overview',        bn: 'রিপোর্ট',         permKey: 'expense' },
      { key: 'expense',            label: 'New Expense',     bn: 'নতুন খরচ' },
      { key: 'expenseList',        label: 'History',         bn: 'খরচের ইতিহাস',  permKey: 'expense' },
      { key: 'expenseCategories',  label: 'Categories',      bn: 'খরচের ধরন',     permKey: 'expense' },
      { key: 'expensePayees',      label: 'Payees',          bn: 'যাকে টাকা দেই', permKey: 'expense' }
    ]
  },
  {
    key: 'finance', label: 'Business Finance', icon: 'finance', bn: 'মালিকের টাকা ও ঋণ', sidebarGroup: 4, sidebarOrder: 120,
    children: [
      { key: 'finance',       label: 'Business Finance', bn: 'টাকা জমা বা তোলা' },
      { key: 'financePersonLedger', label: 'Person Ledger', bn: 'ব্যক্তির হিসাব', permKey: 'finance' },
      { key: 'financeLedger', label: 'Finance Ledger',   bn: 'লেনদেনের হিসাব', permKey: 'finance' }
    ]
  },
  { key: 'daybook',   label: 'Day Book',      icon: 'daybook', bn: 'আজকের সব লেনদেন', sidebarGroup: 4, sidebarOrder: 90 },
  { key: 'cashReconciliation', label: 'Cash Reconciliation', icon: 'cashReconciliation', bn: 'ক্যাশ মিল', sidebarGroup: 4, sidebarOrder: 95 },
  { key: 'reports',   label: 'Reports',       icon: 'reports', bn: 'ব্যবসার রিপোর্ট', sidebarGroup: 5, sidebarOrder: 130 },
  {
    key: 'settings', label: 'Settings', icon: 'settings', bn: 'দোকানের সেটিং', sidebarGroup: 6, sidebarOrder: 140,
    children: [
      { key: 'settings', label: 'General', bn: 'সাধারণ সেটিং' },
      { key: 'invoiceDesign', label: 'Invoice Design', bn: 'রশিদের ডিজাইন' },
      // Users and Roles are Administrator-only via requireAdmin_, not via
      // the permission grid, so they are flagged rather than granted.
      { key: 'users', label: 'Users', bn: 'কর্মচারীর তালিকা' },
      { key: 'roles', label: 'Roles', bn: 'কে কী করতে পারবে' }
    ]
  }
];

/**
 * Return the original UI.gs#getAppShellData response shape without private
 * Settings rows or a module-level mutable response cache. A caller may edit
 * its own cloned nav tree, but cannot poison later read results.
 */
/**
 * Pure source-shaped response projection shared by the internal M03 reader
 * and the separately M04-authorized D1 reader. Never use this to grant
 * permissions: NAV_ITEMS describes presentation only.
 */
export function buildSourceAppShellData({shopName,currencySymbol}){
  return {
    success:true,
    data:{shopName,currencySymbol,navItems:structuredClone(NAV_ITEMS)}
  };
}

export function createSourceShapedAppShellReader(env){
  const settings=createSettingsReadAdapter(env);
  return Object.freeze({
    async getAppShellData(){
      return buildSourceAppShellData(await settings.getAppShellSettings_());
    }
  });
}
