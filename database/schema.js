function addColumnIfMissing(db, table, column, definition) {
  try {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all()
    if (!info.find(c => c.name === column)) {
      db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`)
      console.log(`[DB Migration] Columna '${column}' agregada a tabla '${table}'`)
    }
  } catch (e) {
    console.error(`[DB Migration] Error en migración '${column}' → '${table}':`, e.message)
  }
}

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      category TEXT DEFAULT '',
      color TEXT DEFAULT '',
      cost REAL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      min_stock INTEGER DEFAULT 5,
      image_data TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_sizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      size TEXT NOT NULL,
      stock INTEGER DEFAULT 0,
      min_stock INTEGER DEFAULT 2,
      size_barcode TEXT DEFAULT NULL,
      tn_last_synced DATETIME DEFAULT NULL,
      stock_modified_at DATETIME DEFAULT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(product_id, size)
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      dni TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      balance REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      birth_date TEXT DEFAULT '',
      city TEXT DEFAULT '',
      province TEXT DEFAULT '',
      total_spent REAL DEFAULT 0,
      purchase_count INTEGER DEFAULT 0,
      last_purchase TEXT DEFAULT '',
      points INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cashbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opening_cash REAL DEFAULT 0,
      real_cash REAL,
      closing_cash REAL,
      difference REAL,
      status TEXT DEFAULT 'open',
      notes TEXT DEFAULT '',
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      total REAL NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL DEFAULT 0,
      payment_method TEXT NOT NULL,
      notes TEXT DEFAULT '',
      cashbox_id INTEGER,
      voided INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (cashbox_id) REFERENCES cashbox(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      size TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      unit_cost REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cuit TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      cbu TEXT DEFAULT '',
      alias_cbu TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      balance REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER,
      invoice_number TEXT DEFAULT '',
      total REAL NOT NULL,
      paid REAL DEFAULT 0,
      due_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      size TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      concept TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'Efectivo',
      cashbox_id INTEGER,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cashbox_id) REFERENCES cashbox(id)
    );

    CREATE TABLE IF NOT EXISTS account_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      sale_id INTEGER,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      purchase_id INTEGER,
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'Transferencia',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (purchase_id) REFERENCES purchases(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER,
      type TEXT NOT NULL,
      number TEXT DEFAULT '',
      client_name TEXT DEFAULT '',
      client_dni TEXT DEFAULT '',
      client_address TEXT DEFAULT '',
      total REAL NOT NULL,
      items_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      entity_id INTEGER,
      description TEXT DEFAULT '',
      old_data TEXT DEFAULT '',
      new_data TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
    CREATE INDEX IF NOT EXISTS idx_product_sizes_product_id ON product_sizes(product_id);
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales(client_id);
    CREATE INDEX IF NOT EXISTS idx_sales_cashbox_id ON sales(cashbox_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_cashbox_id ON expenses(cashbox_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON purchases(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_module ON audit_log(module);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('business_name',          'DELPA'),
      ('business_address',       ''),
      ('business_phone',         ''),
      ('business_cuit',          ''),
      ('business_logo',          ''),
      ('business_instagram',     ''),
      ('business_facebook',      ''),
      ('business_whatsapp',      ''),
      ('business_website',       ''),
      ('business_hours',         ''),
      ('custom_sizes',           '[]'),
      ('custom_categories',      '[]'),
      ('custom_payment_methods', '[]');

    CREATE TABLE IF NOT EXISTS cashbox_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashbox_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      concept TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'Efectivo',
      sale_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cashbox_id) REFERENCES cashbox(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      client_phone TEXT DEFAULT '',
      items_json TEXT DEFAULT '[]',
      total REAL DEFAULT 0,
      advance REAL DEFAULT 0,
      status TEXT DEFAULT 'pendiente',
      notes TEXT DEFAULT '',
      delivery_date TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cashbox_movements_cashbox ON cashbox_movements(cashbox_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS sucursales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      size TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      from_sucursal_id INTEGER,
      to_sucursal_id INTEGER,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (from_sucursal_id) REFERENCES sucursales(id),
      FOREIGN KEY (to_sucursal_id) REFERENCES sucursales(id)
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      size TEXT NOT NULL,
      system_stock INTEGER DEFAULT 0,
      real_stock INTEGER DEFAULT 0,
      difference INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_items_session ON inventory_items(session_id);

    CREATE TABLE IF NOT EXISTS sale_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      installments INTEGER DEFAULT 1,
      surcharge_rate REAL DEFAULT 0,
      surcharge_amount REAL DEFAULT 0,
      final_amount REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);

    CREATE TABLE IF NOT EXISTS tn_product_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_product_id INTEGER NOT NULL,
      tn_product_id INTEGER NOT NULL,
      UNIQUE(local_product_id),
      FOREIGN KEY (local_product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tn_variant_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_product_id INTEGER NOT NULL,
      size TEXT NOT NULL,
      tn_variant_id INTEGER NOT NULL,
      tn_product_id INTEGER NOT NULL,
      UNIQUE(local_product_id, size)
    );

    CREATE TABLE IF NOT EXISTS client_points_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      sale_id INTEGER,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_points_log_client ON client_points_log(client_id);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'vendedor',
      active INTEGER DEFAULT 1,
      seller_name TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // New tables added as CREATE IF NOT EXISTS (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_exchanges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name TEXT DEFAULT '',
      returned_product_id INTEGER,
      returned_product_name TEXT DEFAULT '',
      returned_size TEXT DEFAULT '',
      returned_qty INTEGER DEFAULT 1,
      returned_price REAL DEFAULT 0,
      new_product_id INTEGER,
      new_product_name TEXT DEFAULT '',
      new_size TEXT DEFAULT '',
      new_qty INTEGER DEFAULT 1,
      new_price REAL DEFAULT 0,
      difference REAL DEFAULT 0,
      resolution TEXT DEFAULT 'paid',
      notes TEXT DEFAULT '',
      seller_name TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (returned_product_id) REFERENCES products(id),
      FOREIGN KEY (new_product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS product_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_sale_id INTEGER,
      client_id INTEGER,
      client_name TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      total REAL DEFAULT 0,
      resolution TEXT DEFAULT 'cash',
      items_json TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      seller_name TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (original_sale_id) REFERENCES sales(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS senas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name TEXT NOT NULL,
      client_phone TEXT DEFAULT '',
      product_id INTEGER,
      product_name TEXT NOT NULL,
      size TEXT DEFAULT '',
      color TEXT DEFAULT '',
      total_price REAL DEFAULT 0,
      advance_amount REAL DEFAULT 0,
      remaining REAL DEFAULT 0,
      deadline TEXT DEFAULT '',
      status TEXT DEFAULT 'pendiente',
      notes TEXT DEFAULT '',
      sale_id INTEGER,
      refunded INTEGER DEFAULT 0,
      seller_name TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );
    CREATE INDEX IF NOT EXISTS idx_senas_status ON senas(status);
    CREATE INDEX IF NOT EXISTS idx_senas_deadline ON senas(deadline);
    CREATE INDEX IF NOT EXISTS idx_exchanges_created ON product_exchanges(created_at);
    CREATE INDEX IF NOT EXISTS idx_returns_created ON product_returns(created_at);

    CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      commission_rate REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER,
      supplier_name TEXT DEFAULT '',
      date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      total REAL DEFAULT 0,
      items_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS remitos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'venta',
      recipient TEXT DEFAULT '',
      address TEXT DEFAULT '',
      items_json TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'pendiente',
      origin_sucursal_id INTEGER,
      dest_sucursal_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS stock_egresos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE NOT NULL,
      supplier_id INTEGER,
      supplier_name TEXT DEFAULT '',
      date TEXT NOT NULL,
      reason TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      total_amount REAL DEFAULT 0,
      total_units INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','confirmed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stock_egreso_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      egreso_id INTEGER NOT NULL REFERENCES stock_egresos(id) ON DELETE CASCADE,
      product_id INTEGER,
      product_name TEXT DEFAULT '',
      size TEXT DEFAULT '',
      color TEXT DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      cost_price REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_egreso_items_egreso ON stock_egreso_items(egreso_id);

    CREATE TABLE IF NOT EXISTS fixed_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      category TEXT DEFAULT 'General',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      client_phone TEXT DEFAULT '',
      product_id INTEGER,
      product_name TEXT NOT NULL,
      size TEXT DEFAULT '',
      color TEXT DEFAULT '',
      estimated_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'waiting',
      notified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);

    CREATE TABLE IF NOT EXISTS fiscal_comprobantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_cbte INTEGER NOT NULL,
      pto_vta INTEGER NOT NULL,
      nro_cbte INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      cuit_receptor TEXT DEFAULT '',
      imp_neto REAL DEFAULT 0,
      imp_iva REAL DEFAULT 0,
      imp_total REAL DEFAULT 0,
      cae TEXT DEFAULT '',
      cae_fch_vto TEXT DEFAULT '',
      fuente TEXT DEFAULT 'afip',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tipo_cbte, pto_vta, nro_cbte)
    );
    CREATE INDEX IF NOT EXISTS idx_fiscal_fecha ON fiscal_comprobantes(fecha);

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      product_name TEXT DEFAULT '',
      old_price REAL NOT NULL,
      new_price REAL NOT NULL,
      changed_by TEXT DEFAULT 'sistema',
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
    CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(changed_at);

    CREATE TABLE IF NOT EXISTS supplier_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER,
      supplier_name TEXT DEFAULT '',
      supplier_email TEXT DEFAULT '',
      supplier_phone TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      notes TEXT DEFAULT '',
      total REAL DEFAULT 0,
      items_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_orders_supplier ON supplier_orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_orders_status ON supplier_orders(status);
  `)

  // v2.x new features: vouchers, consignment
  db.exec(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      client_id INTEGER,
      client_name TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',
      conditions TEXT DEFAULT '',
      used INTEGER DEFAULT 0,
      used_at DATETIME,
      sale_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
    CREATE INDEX IF NOT EXISTS idx_vouchers_used ON vouchers(used);

    CREATE TABLE IF NOT EXISTS consignment_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL,
      cost_per_unit REAL NOT NULL,
      active INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS consignment_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      size TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      cost_per_unit REAL NOT NULL,
      total_cost REAL NOT NULL,
      supplier_id INTEGER NOT NULL,
      supplier_name TEXT DEFAULT '',
      liquidated INTEGER DEFAULT 0,
      liquidation_id INTEGER,
      sold_at DATETIME NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_consignment_sales_supplier ON consignment_sales(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_consignment_sales_liq ON consignment_sales(liquidated);

    CREATE TABLE IF NOT EXISTS consignment_liquidations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL,
      supplier_id INTEGER NOT NULL,
      supplier_name TEXT DEFAULT '',
      total_amount REAL NOT NULL,
      total_units INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
  `)

  const migrations = [
    "ALTER TABLE clients ADD COLUMN points INTEGER DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN installments INTEGER DEFAULT 1",
    "ALTER TABLE sales ADD COLUMN surcharge_rate REAL DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN voucher_type TEXT DEFAULT 'ticket'",
    "ALTER TABLE sales ADD COLUMN seller_name TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN birth_date TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN city TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN province TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN total_spent REAL DEFAULT 0",
    "ALTER TABLE clients ADD COLUMN purchase_count INTEGER DEFAULT 0",
    "ALTER TABLE clients ADD COLUMN last_purchase TEXT DEFAULT ''",
    // v1.3.0 migrations
    "ALTER TABLE sales ADD COLUMN sale_number TEXT DEFAULT ''",
    "ALTER TABLE sales ADD COLUMN void_reason TEXT DEFAULT ''",
    "ALTER TABLE sales ADD COLUMN sucursal_id INTEGER DEFAULT NULL",
    "ALTER TABLE cashbox ADD COLUMN payment_counts_json TEXT DEFAULT '{}'",
    // v1.4.0 AFIP migrations
    "ALTER TABLE sales ADD COLUMN cae TEXT DEFAULT ''",
    "ALTER TABLE sales ADD COLUMN cae_fch_vto TEXT DEFAULT ''",
    "ALTER TABLE sales ADD COLUMN tipo_cbte INTEGER DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN cbte_nro INTEGER DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN pto_venta INTEGER DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN doc_tipo INTEGER DEFAULT 99",
    "ALTER TABLE sales ADD COLUMN doc_nro TEXT DEFAULT '0'",
    "ALTER TABLE invoices ADD COLUMN cae TEXT DEFAULT ''",
    "ALTER TABLE invoices ADD COLUMN cae_fch_vto TEXT DEFAULT ''",
    "ALTER TABLE invoices ADD COLUMN tipo_cbte INTEGER DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN cbte_nro INTEGER DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN pto_venta INTEGER DEFAULT 0",
    // v2.0 — TN sync toggle + color variants
    "ALTER TABLE products ADD COLUMN tn_sync INTEGER DEFAULT 1",
    "ALTER TABLE products ADD COLUMN parent_product_id INTEGER DEFAULT NULL",
    "ALTER TABLE products ADD COLUMN is_variant INTEGER DEFAULT 0",
    // v2.1 — Mercado Pago QR
    "ALTER TABLE sales ADD COLUMN mp_payment_id TEXT DEFAULT ''",
    // v2.2 — EAN-13 per size
    "ALTER TABLE product_sizes ADD COLUMN size_barcode TEXT DEFAULT NULL",
  ]
  for (const sql of migrations) { try { db.exec(sql) } catch {} }

  // Set sensible defaults for category_size_groups; always merge known categories
  try {
    const DEFAULTS = {
      Jeans: 'numeric', Pantalones: 'numeric',
      Camisas: 'clothing', Remeras: 'clothing', Buzos: 'clothing',
      Camperas: 'clothing', Shorts: 'clothing', 'Ropa interior': 'clothing',
      Calzado: 'shoe',
    }
    const csg = db.prepare("SELECT value FROM settings WHERE key='category_size_groups'").get()
    let current = {}
    try { if (csg?.value) current = JSON.parse(csg.value) } catch {}
    const merged = { ...DEFAULTS, ...current }
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('category_size_groups',?)").run(JSON.stringify(merged))
  } catch {}

  const newSettings = [
    ['email_smtp',             'smtp.gmail.com'],
    ['email_port',             '587'],
    ['email_user',             ''],
    ['email_from',             ''],
    ['email_pass',             ''],
    ['email_to',               ''],
    ['sellers',                '[]'],
    ['birthday_message',       'Feliz cumple [nombre]! 🎁 Pasate por el local, te tenemos un regalo especial 🎉'],
    ['sale_seq',               '0'],
    ['current_sucursal_id',    ''],
    ['current_sucursal_name',  ''],
    ['afip_env',               'testing'],
    ['afip_punto_venta',       '1'],
    ['afip_cond_fiscal',       'RI'],
    ['category_size_groups',   '{}'],
    ['theme',                  'dark'],
    ['tn_access_token',        ''],
    ['tn_store_id',            ''],
    ['tn_store_url',           ''],
    ['tn_connected_at',        ''],
    ['tn_last_sync',           ''],
    ['points_enabled',         '0'],
    ['points_per_pesos',       '1000'],
    ['point_value',            '100'],
    ['points_min_redeem',      '5'],
    ['license_installed_at',   ''],
    ['license_code',           ''],
    ['license_expiry',         ''],
    ['license_expiry_notified',''],
    ['mp_sandbox',           '0'],
    ['mp_access_token',      ''],
    ['mp_user_id',           '3429544372'],
    ['mp_store_id',          ''],
    ['mp_store_external_id', ''],
    ['mp_pos_id',            '132581975'],
    ['mp_pos_external_id',   'petalogestion'],
    ['mp_pos_name',          'Caja 1'],
    ['mp_qr_data',           ''],
    ['mp_qr_image',          ''],
    ['mp_qr_pdf',            ''],
    ['barcode_scanner',     '0'],
    ['wizard_completed',    '0'],
    ['monthly_goal',        '0'],
    ['sena_seq',            '0'],
    ['barcode_migration_done', '0'],
    ['email_contador',         ''],
    ['cashbox_shifts',         '["Mañana","Tarde"]'],
    ['share_stock_online',    '0'],
    ['stock_access_pin',      ''],
    ['stock_public_file_id',  ''],
    ['surcharges_json',  JSON.stringify({
      'Tarjeta Débito': 0,
      'Tarjeta Crédito 1 cuota': 0,
      'Tarjeta Crédito 3 cuotas': 10,
      'Tarjeta Crédito 6 cuotas': 18,
      'Tarjeta Crédito 12 cuotas': 30,
      'Tarjeta Crédito 18 cuotas': 45,
      'Tarjeta Crédito 24 cuotas': 60,
    })],
  ]
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)')
  for (const [k, v] of newSettings) insSet.run(k, v)

  // Corrective migration: fix stale MP defaults from older builds
  try {
    db.prepare("UPDATE settings SET value='petalogestion' WHERE key='mp_pos_external_id' AND value IN ('DELPACAJA1','DELPA1','')").run()
    db.prepare("UPDATE settings SET value='132581975'   WHERE key='mp_pos_id'           AND value=''").run()
    db.prepare("UPDATE settings SET value='3429544372'  WHERE key='mp_user_id'           AND value=''").run()
  } catch {}

  // Robust column migrations (idempotent — safe to re-run every startup)
  addColumnIfMissing(db, 'product_sizes', 'size_barcode',      'TEXT DEFAULT NULL')
  addColumnIfMissing(db, 'product_sizes', 'tn_last_synced',    'DATETIME DEFAULT NULL')
  addColumnIfMissing(db, 'product_sizes', 'stock_modified_at', 'DATETIME DEFAULT NULL')
  addColumnIfMissing(db, 'cashbox', 'shift',             "TEXT DEFAULT ''")
  addColumnIfMissing(db, 'sales',   'voucher_code',      "TEXT DEFAULT ''")
  addColumnIfMissing(db, 'sales',   'voucher_discount',  'REAL DEFAULT 0')
  addColumnIfMissing(db, 'stock_entries', 'is_consignment', 'INTEGER DEFAULT 0')
  addColumnIfMissing(db, 'clients', 'birth_date',     "TEXT DEFAULT ''")
  addColumnIfMissing(db, 'clients', 'city',           "TEXT DEFAULT ''")
  addColumnIfMissing(db, 'clients', 'province',       "TEXT DEFAULT ''")
  addColumnIfMissing(db, 'clients', 'total_spent',    'REAL DEFAULT 0')
  addColumnIfMissing(db, 'clients', 'purchase_count', 'INTEGER DEFAULT 0')
  addColumnIfMissing(db, 'clients', 'last_purchase',  "TEXT DEFAULT ''")
  addColumnIfMissing(db, 'clients', 'points',         'INTEGER DEFAULT 0')

  // One-time migration: generate size_barcode for all existing sizes that don't have one
  try {
    const migDone = db.prepare("SELECT value FROM settings WHERE key='barcode_migration_done'").get()
    if (!migDone || migDone.value !== '1') {
      const ALPHA = { XS: 80, S: 81, M: 82, L: 83, XL: 84, XXL: 85, XXXL: 86, '4XL': 87, '5XL': 88, Único: 89, UNICO: 89, unico: 89 }
      function sizeToCode(size) {
        const s = String(size).trim()
        if (ALPHA[s] !== undefined) return ALPHA[s]
        const num = parseInt(s, 10)
        if (!isNaN(num) && num >= 0 && num <= 79) return num
        let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xff
        return 90 + (h % 10)
      }
      function genSizeBarcode(productId, size) {
        const sizeCode = sizeToCode(size)
        const pid = Math.abs(Number(productId)) % 10000000
        const base = '779' + String(pid).padStart(7, '0') + String(sizeCode).padStart(2, '0')
        let sum = 0
        for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3)
        return base + String((10 - sum % 10) % 10)
      }
      const pending = db.prepare("SELECT id, product_id, size FROM product_sizes WHERE size_barcode IS NULL OR size_barcode=''").all()
      const upd = db.prepare('UPDATE product_sizes SET size_barcode=? WHERE id=?')
      const migrate = db.transaction(() => {
        for (const row of pending) upd.run(genSizeBarcode(row.product_id, row.size), row.id)
      })
      migrate()
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('barcode_migration_done','1')").run()
      if (pending.length > 0) console.log(`[DB Migration] Códigos de barras por talle: ${pending.length} talles actualizados`)
    }
  } catch (e) {
    console.error('[DB Migration] Error en migración de códigos de barras:', e.message)
  }

  // Default admin user (password: admin123)
  const crypto = require('crypto')
  const adminHash = crypto.createHash('sha256').update('admin123').digest('hex')
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role, active) VALUES (?,?,?,1)')
    .run('admin', adminHash, 'admin')
}

module.exports = { createTables }
