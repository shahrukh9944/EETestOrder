'use strict';
/**
 * Test-data generation, ported from client/src/pages/TestPage.js.
 * Only the SKU list differs (now configured: S1-BL-S, S2-WH-S, S1-RD-M).
 */
const config = require('../config/apiConfig');

const NAMES = ['Sophia', 'Emma', 'Olivia', 'Ava', 'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn',
  'Abigail', 'Emily', 'Elizabeth', 'Sofia', 'Camila', 'Scarlett', 'Victoria', 'Madison', 'Luna', 'Chloe'];
const ADDRESSES = ['123 Main St', '4 Oak Ave', '7 Pine Rd', '10 Elm St', '2 Maple Dr', '5 Birch Ln', '9 Cedar Rd',
  '11 Spruce', '3 Willow', '8 Park Ave', '6 Hill St', '1 Lake Dr', '12 River', '15 Sun Rd', '17 Moon Ln',
  '19 Star St', '20 Sky Dr', '14 Wind Rd', '18 Rain Ln', '13 Snow St'];
const QUANTITIES = ['1', '2', '3', '4', '5'];
const LOCATIONS = [
  { postalCode: '400001', city: 'Mumbai', state: 'Maharashtra' },
  { postalCode: '110001', city: 'New Delhi', state: 'Delhi' },
  { postalCode: '600001', city: 'Chennai', state: 'Tamil Nadu' },
  { postalCode: '700001', city: 'Kolkata', state: 'West Bengal' },
  { postalCode: '500001', city: 'Hyderabad', state: 'Telangana' },
  { postalCode: '560001', city: 'Bengaluru', state: 'Karnataka' },
  { postalCode: '380001', city: 'Ahmedabad', state: 'Gujarat' },
  { postalCode: '302001', city: 'Jaipur', state: 'Rajasthan' },
  { postalCode: '800001', city: 'Patna', state: 'Bihar' },
  { postalCode: '452001', city: 'Indore', state: 'Madhya Pradesh' },
  { postalCode: '411001', city: 'Pune', state: 'Maharashtra' },
  { postalCode: '250001', city: 'Meerut', state: 'Uttar Pradesh' },
  { postalCode: '141001', city: 'Ludhiana', state: 'Punjab' },
  { postalCode: '144001', city: 'Jalandhar', state: 'Punjab' },
  { postalCode: '403001', city: 'Panaji', state: 'Goa' },
  { postalCode: '160001', city: 'Chandigarh', state: 'Chandigarh' },
  { postalCode: '695001', city: 'Thiruvananthapuram', state: 'Kerala' },
  { postalCode: '751001', city: 'Bhubaneswar', state: 'Odisha' },
  { postalCode: '834001', city: 'Ranchi', state: 'Jharkhand' },
  { postalCode: '796001', city: 'Aizawl', state: 'Mizoram' },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');

/** 'yyyy-MM-dd HH:mm:ss' (what date-fns produced in the original) */
function formatDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Two random letters + yyyymmdd + random 01-99 (original orderIdGen) */
function generateOrderId() {
  const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26), 65 + Math.floor(Math.random() * 26));
  const now = new Date();
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${letters}${date}${pad(Math.floor(Math.random() * 99) + 1)}`;
}

/** Builds one createOrder payload - same structure as the original `orderdata`. */
function buildOrderPayload() {
  const orderId = generateOrderId();
  const custName = pick(NAMES);
  const addressLine1 = pick(ADDRESSES);
  const loc = pick(LOCATIONS);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    orderType: 'retailorder',
    marketplaceId: pick(config.business.marketplaceIds),
    orderNumber: orderId,
    orderDate: formatDateTime(now),
    expDeliveryDate: formatDateTime(tomorrow),
    items: [{ OrderItemId: orderId, Sku: pick(config.business.skus), Quantity: pick(QUANTITIES), Price: 200 }],
    customer: [{
      billing: {
        name: custName, addressLine1, postalCode: loc.postalCode, city: loc.city, state: loc.state,
        country: 'India', contact: '9876543210', email: 'test@gmail.com',
      },
      shipping: {
        name: custName, addressLine1, postalCode: loc.postalCode, city: loc.city, state: loc.state,
        country: 'India', contact: '9876543210', email: 'test@gmail.com',
        latitude: '12.900222', longitude: '77.650914',
      },
    }],
  };
}

module.exports = { buildOrderPayload, generateOrderId, formatDateTime };
