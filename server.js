// server.js
// -----------------------------------------------------------------------
// PitLane Shop - a small storefront + order/stock tracker.
//
// Routes:
//   GET  /api/products              -> list products with live stock
//   POST /api/orders                -> place an order (public, from the shop)
//   POST /api/admin/login           -> admin logs in with a password
//   GET  /api/admin/orders          -> list all orders (admin only)
//   PATCH /api/admin/orders/:id     -> update an order's status (admin only)
//   PATCH /api/admin/products/:id   -> update a product's stock (admin only)
// -----------------------------------------------------------------------

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Change this before you put the site online! You can also set it with
// an environment variable instead of editing the code - see README.md.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- very small session system (good enough for a one-person admin) ----
const validTokens = new Set();

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token && validTokens.has(token)) return next();
  return res.status(401).json({ error: 'Not logged in.' });
}

// ---- public: products -----------------------------------------------------

app.get('/api/products', (req, res) => {
  const products = db.getProducts().map((p) => ({
    ...p,
    soldOut: p.stock <= 0,
  }));
  res.json(products);
});

// ---- public: place an order ------------------------------------------------

app.post('/api/orders', (req, res) => {
  const { productId, size, quantity, customerName, phone, city, address, notes } = req.body || {};

  if (!productId || !customerName || !phone || !city || !address) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const product = db.getProduct(productId);
  if (!product) return res.status(404).json({ error: 'That product does not exist.' });

  const result = db.decrementStock(productId, qty);
  if (!result.ok) {
    if (result.reason === 'insufficient_stock') {
      return res.status(409).json({
        error: `Sorry, only ${result.available} left in stock.`,
      });
    }
    return res.status(400).json({ error: 'Could not place the order.' });
  }

  const order = db.createOrder({
    productId,
    productName: product.name,
    price: product.price,
    size: size || 'N/A',
    quantity: qty,
    total: product.price * qty,
    customerName,
    phone,
    city,
    address,
    notes: notes || '',
  });

  res.status(201).json({ order, soldOut: result.product.stock <= 0 });
});

// ---- admin: login -----------------------------------------------------------

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  validTokens.add(token);
  res.json({ token });
});

// ---- admin: orders ------------------------------------------------------------

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(db.getOrders());
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const allowed = ['new', 'contacted', 'fulfilled', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const order = db.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
});

// ---- admin: restock / edit stock directly --------------------------------------

app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  const { stock } = req.body || {};
  if (typeof stock !== 'number' || stock < 0) {
    return res.status(400).json({ error: 'Stock must be a number 0 or higher.' });
  }
  const product = db.setProductStock(req.params.id, stock);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json(product);
});

app.listen(PORT, () => {
  console.log(`PitLane Shop running -> http://localhost:${PORT}`);
  console.log(`Admin dashboard      -> http://localhost:${PORT}/admin.html`);
});
