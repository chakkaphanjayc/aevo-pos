# Aevo POS — Store Core Implementation Plan

แผนนี้ปรับจาก Phase 0–11 เดิมให้เป้าหมายหลักเป็น **ระบบหน้าร้านที่ขายได้จริงโดยไม่ต้องพึ่ง Odoo** ก่อน โดยมีใบเสร็จ การรับชำระเงิน Cash Session และบัญชีเบื้องต้นครบ แล้วจึงต่อ Odoo Adapter สำหรับร้านที่ต้องการระบบหลังบ้านขั้นสูง

## 1. เป้าหมายใหม่

Aevo POS ต้องทำให้ร้านสามารถ:

1. ตั้งค่าสินค้าและเมนู
2. เปิดกะและกำหนดเงินทอนเริ่มต้น
3. รับออเดอร์หน้าร้าน
4. คำนวณราคา ส่วนลด และภาษี
5. รับเงินสด/PromptPay/บัตร
6. ออกใบเสร็จและพิมพ์ซ้ำ
7. ยกเลิก Void และ Refund ตามสิทธิ์
8. ส่งงานไป Queue/KDS
9. ปิดกะและตรวจเงิน
10. ดูยอดขายและบัญชีเบื้องต้น
11. ทำงานต่อได้แม้ Odoo หรือบริการภายนอกล่ม

สิ่งที่ยังไม่ทำเป็นบัญชีเต็มรูปแบบใน Store Core ได้แก่ General Ledger, AP/AR, Bank Reconciliation, Closing Period และเอกสารภาษีเต็มรูปแบบ ซึ่งจะรองรับผ่าน Odoo Adapter หรือ Accounting Module ในอนาคต

## 2. การเปลี่ยนแปลงจากแผนเดิม

| แผนเดิม | แผนใหม่ |
|---|---|
| POS เน้นสร้าง Order และรับ Cash | POS ต้องจบตั้งแต่ Order → Payment → Receipt |
| Cash Session อยู่ Phase 10 | ย้ายมาเป็น MVP ก่อนเปิดใช้งานจริง |
| Reporting อยู่ Phase 10 | เพิ่ม Basic Sales Ledger ตั้งแต่ MVP |
| Receipt เป็นส่วนย่อยของ POS | ทำ Receipt เป็นเอกสาร Domain แยกจาก Order |
| Odoo อยู่ Phase 11 แต่ขอบเขตยังกว้าง | จำกัดเป็น Outbox Adapter และ Mapping ที่ต่อภายหลังได้ |
| QR/Queue/KDS มาก่อนระบบการเงิน | ทำ Commerce Foundation ก่อน แล้วค่อยขยายช่องทาง |
| Catalog เน้นฟอร์มสร้างข้อมูล | เพิ่ม Product List, Search, Status, Image และ Edit Drawer |

## 3. หลักการที่ต้องคงไว้

- ทุกช่องทางใช้ Unified Order Aggregate เดียวกัน
- ไม่สร้าง `pos_orders`, `qr_orders` หรือ `kiosk_orders`
- Server เป็นผู้คำนวณยอดจริงและตรวจสิทธิ์
- Order Item ต้องเก็บ Product/Variant/Modifier snapshot
- ทุกการชำระเงินต้องมี idempotency
- ทุกการเปลี่ยนสถานะสำคัญต้องสร้าง Domain Event และ Outbox Event
- Odoo, LINE, Payment Gateway และ Notification ห้ามอยู่ใน Transaction หลักของ Order
- ทุกข้อมูลต้องถูกจำกัดด้วย Organization และ Store
- การ Void, Refund, Price Override และ Cash Adjustment ต้องมี Audit Log
- เว็บ PWA เป็น Client หลัก และเปิดทางให้ Capacitor/Tauri เพิ่ม Hardware Adapter ภายหลัง

## 4. สถาปัตยกรรมเป้าหมาย

```text
Astro PWA
  ├── Customer Ordering
  ├── Staff POS
  ├── Catalog
  ├── Orders
  ├── KDS / Queue
  └── Receipt / Reports
          ↓
Cloudflare Worker + Elysia API
  ├── Auth + RBAC + Tenant Isolation
  ├── Catalog
  ├── Pricing + Tax
  ├── Ordering
  ├── Payments
  ├── Receipts
  ├── Cash Sessions
  └── Reporting
          ↓
Supabase PostgreSQL + Auth
          ↓
Domain Events + Outbox
  ├── Queue / Preparation
  ├── Notification
  └── Odoo Adapter (optional)
```

## 5. สถานะปัจจุบันที่ใช้เป็น Baseline

มีแล้วหรืออยู่ในฐานระบบเดิม:

- Bun monorepo
- Astro Web
- Cloudflare Worker + Elysia API
- Supabase Auth และ PostgreSQL
- HttpOnly session cookie
- Organization, Store, Membership และ RBAC foundation
- Catalog: categories, products, variants, menus, modifiers, availability
- Unified Orders และ state machine
- Order items/modifier snapshots
- Payment records เบื้องต้น
- Domain events, outbox และ idempotency
- Staff workspace และ Orders page

ต้องตรวจสอบก่อนเริ่มงานถัดไป:

- `/health` ต้องตอบ `200`
- `/ready` ต้องตอบ `200`
- Worker Production ต้องมี `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `WEB_ORIGIN`
- Login และ `/api/auth/me` ต้องทำงานผ่าน Production domain
- Supabase RLS และ service-role access ต้องผ่าน tenant-isolation tests

## Phase 0 — Production Readiness

### เป้าหมาย

ปลดล็อก Runtime ให้ระบบที่ deploy บน Cloudflare ใช้งานได้จริงก่อนเพิ่ม Feature ใหม่

### งานหลัก

- ตรวจ `wrangler.jsonc` และ `ASSETS` binding
- ตรวจ Production/Preview environment variables
- แก้ error `RUNTIME_NOT_CONFIGURED` และ `SUPABASE_SECRET_KEY is not configured`
- ทดสอบ `/health`, `/ready`, login, logout, refresh และ `/api/auth/me`
- ตรวจ cookie: HttpOnly, Secure ใน Production, SameSite และ Domain
- ตรวจ CORS ให้ตรงกับ Web Origin
- เปิด Supabase leaked-password protection
- รัน seed owner/admin ผ่านคำสั่งที่รองรับ `.env`
- รัน typecheck, unit tests, integration tests และ production build

### Exit criteria

- `/ready` เป็น `200`
- Login สำเร็จบน Worker domain
- ผู้ใช้เห็นเฉพาะองค์กรและสาขาที่ได้รับอนุญาต
- CI บน `main` ผ่านทั้งหมด

## Phase 1 — Catalog Hardening

### เป้าหมาย

ทำ Catalog ให้พนักงานตั้งค่าเมนูจริงและค้นหาสินค้าได้รวดเร็ว

### Domain และ Database

- Product, Product Variant, Category
- Menu, Menu Item
- Modifier Group, Modifier
- Product ↔ Modifier Group mapping
- Store/Channel availability
- Sold-out state
- Tax category และราคาสินค้า
- Product image URL และ display order

เพิ่ม unique/index ที่ tenant scope เช่น `(organization_id, sku)` และ `(store_id, product_id)`

### API

- `GET /api/catalog`
- `POST/PATCH /api/catalog/categories`
- `POST/PATCH /api/catalog/products`
- `POST/PATCH /api/catalog/variants`
- `POST/PATCH /api/catalog/modifier-groups`
- `POST/PATCH /api/catalog/modifiers`
- `POST/PATCH /api/catalog/product-modifier-groups`
- `PATCH /api/catalog/availability`
- `PATCH /api/catalog/products/:id/sold-out`

### UI

- Product list/table หรือ grid พร้อม Search และ Filter
- แสดงรูป ราคา SKU หมวดหมู่ สถานะขาย และ Sold out
- Create/Edit ใช้ Drawer หรือ Modal ไม่บังคับเลื่อนผ่านฟอร์มยาว
- Bulk sold-out และเปิด/ปิดการขาย
- Preview สินค้าใน POS
- แสดง validation และ unsaved changes อย่างชัดเจน

### Tests

- Catalog tenant isolation
- Product/variant/modifier validation
- Availability filtering ตาม store และ channel
- Product modifier mapping
- Sold-out ไม่ปรากฏในช่องทางขาย

### Exit criteria

สร้างเมนูกาแฟที่มี Size, Temperature, Milk และ Add-on ได้ และสินค้าเดียวกันถูกนำไปใช้ใน POS, QR และ Kiosk ได้

## Phase 2 — Commerce Foundation

Phase นี้เพิ่มสิ่งที่ต้องมีร่วมกันทุกช่องทางก่อนสร้าง POS เต็มรูปแบบ

### 2.1 Pricing และ Tax

- คำนวณราคาจาก Product + Variant + Modifier snapshot
- Subtotal, Discount, Tax, Grand Total
- ส่วนลดแบบจำนวนเงินและเปอร์เซ็นต์
- Tax inclusive/exclusive
- ปัดเศษตามสกุลเงิน
- Server-side recalculation
- ห้าม Client ส่งยอดรวมมาเป็นแหล่งความจริง

### 2.2 Payment Domain

Provider interface:

```ts
createPayment()
confirmPayment()
cancelPayment()
refundPayment()
verifyWebhook()
```

รองรับเริ่มต้น:

- CASH
- PROMPTPAY_MANUAL
- EXTERNAL_CARD
- MANUAL

ข้อมูล Payment ต้องมี amount, method, status, reference, receivedBy, timestamps และ metadata ที่ไม่เก็บ secret

### 2.3 Receipt Domain

แยก Receipt ออกจาก Order และ Payment

Receipt ต้องเก็บ:

- เลขที่ใบเสร็จ
- Order number
- Store snapshot
- รายการสินค้าและราคา snapshot
- ส่วนลดและภาษี
- Payment summary
- Cash received และ change
- Cashier
- วันที่เวลา
- สถานะ reprint/void

API:

- `GET /api/receipts/:id`
- `GET /api/orders/:id/receipt`
- `POST /api/receipts/:id/reprint`
- `POST /api/receipts/:id/void`

รูปแบบ:

- Receipt preview
- Browser print
- A4 print
- Thermal 58/80 mm
- Download/แชร์ลิงก์ใบเสร็จ

### 2.4 Refund และ Void

- Void ก่อนชำระเงิน
- Refund หลังชำระเงิน
- Partial refund
- Manager approval ตาม threshold
- เหตุผลบังคับ
- Audit log และ event

### Exit criteria

Order สามารถคำนวณยอดจริง ชำระเงิน ออก Receipt และป้องกันการชำระซ้ำได้ โดยไม่ต้องพึ่ง Odoo

## Phase 3 — Production POS

### เป้าหมาย

พนักงานขายได้จริงบนโทรศัพท์ Tablet และ Desktop

### Workflow

```text
เปิดกะ → เลือกสินค้า → Modifier → Cart → ราคา/ภาษี
→ Takeaway/Dine-in → Payment → Receipt → Queue/KDS
```

### UI

- Category tabs/sidebar
- Search product
- Touch-friendly product cards
- Modifier modal พร้อม required/min/max validation
- Cart พร้อม quantity stepper
- Customer optional
- Takeaway/Dine-in
- Hold/Retrieve order
- Cash payment modal พร้อมเงินทอน
- Payment method selector
- Receipt modal หลังชำระสำเร็จ
- Order history และ Reprint
- Mobile bottom-sheet cart
- Tablet 2-panel และ Desktop 3-panel
- Online/Offline indicator

### API flow

1. `POST /api/orders` สร้าง DRAFT
2. `POST /api/orders/:id/payments` บันทึก Payment
3. Payment สำเร็จ → Order PAID
4. `POST /api/orders/:id/transition` → CONFIRMED
5. สร้าง Receipt
6. สร้าง Queue/Preparation event

ทุก command ใช้ idempotency key แยกกัน และรองรับ retry อย่างปลอดภัย

### Exit criteria

ร้านสามารถรับเงินสด ออกใบเสร็จ พิมพ์ซ้ำ และส่งออเดอร์ไปเตรียมสินค้าได้จาก Tablet เพียงเครื่องเดียว

## Phase 4 — Cash Session และ Basic Finance

### เป้าหมาย

ให้ผู้จัดการตรวจยอดเงินและยอดขายได้โดยไม่ต้องเปิด Odoo

### Cash Session

- Open session
- Opening float
- Cash in/out
- Paid in/paid out
- Cash sales
- Refund cash
- Expected cash
- Counted cash
- Difference
- Close session
- Manager approval เมื่อส่วนต่างเกิน threshold

### Basic Sales Ledger

บันทึกและสรุป:

- Gross sales
- Discounts
- Tax collected
- Net sales
- Cash
- PromptPay
- Card
- Refund
- Void
- Payment fees

### Reports

- ยอดขายวันนี้
- ยอดขายตามช่วงเวลา
- ยอดขายตามสินค้า/หมวดหมู่
- ยอดขายตามช่องทาง
- ยอดขายตามวิธีชำระ
- Tax summary เบื้องต้น
- Refund/Void report
- Cashier shift report
- Daily closing report

### ขอบเขตที่ไม่อ้างว่าเป็น Full Accounting

รายงานเหล่านี้เป็น operational ledger สำหรับตรวจยอดหน้าร้าน ไม่ใช่ระบบบัญชีสำหรับยื่นภาษีจนกว่าจะต่อ General Ledger, Journal, Bank Reconciliation และเอกสารภาษีครบถ้วน

### Exit criteria

ผู้จัดการเปิดกะ รับเงิน ปิดกะ ตรวจส่วนต่าง และดูยอดขายรายวันได้ครบ

## Phase 5 — Realtime และ Offline-safe POS

### Realtime

- Store room
- Station room
- Order room
- Broadcast order created/paid/confirmed/ready
- อัปเดต POS, Orders, Queue และ KDS
- ตรวจ authorization ก่อน join room

### Offline

- IndexedDB cache: catalog, prices, modifiers, settings, active cart
- Client outbox สำหรับ draft และ cash order
- Local receipt queue
- Sync เมื่อออนไลน์
- ใช้ client operation ID ป้องกัน duplicate
- Online payment ต้อง block เมื่อ offline
- แสดงสถานะ Pending Sync ให้ผู้ใช้เห็น

### Exit criteria

Cash order ที่สร้างระหว่างอินเทอร์เน็ตล่มไม่หายและไม่ถูกสร้างซ้ำเมื่อ sync กลับมา

## Phase 6 — QR Self-order และ Customer Tracking

- Public catalog เฉพาะสินค้าที่ available
- `/order/:store`
- `/order/:store/table/:table`
- Guest cart และ modifier
- Anonymous checkout
- PromptPay/online payment ตาม provider
- Tracking page ด้วย public tracking token
- Electronic receipt
- Customer name/phone optional

Order ที่สร้างจาก QR ต้องใช้ Order Engine และ Payment Domain ชุดเดียวกับ POS

## Phase 7 — Queue Engine

- Queue configuration ต่อ Store
- Queue type: TAKEAWAY, DINE_IN, PICKUP, DRIVE_THROUGH, SERVICE
- Prefix และ daily sequence
- Queue ticket แยกจาก Order number
- Queue manager
- Queue display
- เรียกคิว/ข้ามคิว/เสร็จสิ้น
- Realtime status

## Phase 8 — Preparation / KDS

- Preparation Station: Coffee, Kitchen, Bakery, Dessert, Packing, Pickup
- Product-to-station routing
- Preparation task ต่อ Order Item
- NEW, ACCEPTED, PREPARING, READY, CANCELLED
- Partial ready
- Ready aggregation
- สร้าง `order.ready` เพียงครั้งเดียว
- KDS ที่ใช้บน Tablet/TV ได้

## Phase 9 — Kiosk, Notification และ Pickup

### Kiosk

- Reuse QR self-order
- Fullscreen
- Idle timeout
- Auto clear cart
- กลับ Welcome screen
- Language/accessibility foundation

### Notification

- Web Push
- Merchant LINE OA
- Preferences ต่อ Customer/Device
- Delivery log และ retry
- Notification failure ไม่เปลี่ยน Order state

### Scheduled Pickup

- ASAP และ Scheduled pickup
- pickupAt
- prepareAt
- preparation window
- capacity/cut-off
- no-show foundation

## Phase 10 — Advanced Store Operations

ทำหลัง Store Core เสถียร:

- Table/Floor plan
- Reservation
- Waitlist
- Loyalty
- Promotion engine
- Ingredient inventory
- Stock consumption
- Shift management ขั้นสูง
- Multi-branch reporting
- Cost และ margin analysis

## Phase 11 — Odoo Adapter

### หลักการ

Odoo เป็นระบบหลังบ้านเสริม ไม่ใช่ dependency ของการขายหน้าร้าน

```text
Aevo Store Core
  → Domain Event
  → Integration Outbox
  → Odoo Adapter
  → Odoo API
```

### ข้อมูลที่ส่งได้

- Product
- Customer
- Completed Order
- Payment
- Refund
- Tax
- Inventory consumption
- Daily closing
- Cash session

### Mapping ที่ต้องมี

- Aevo Store → Odoo Company/Warehouse
- Aevo Product → Odoo Product
- Aevo Tax → Odoo Tax
- Aevo Payment Method → Odoo Journal
- Aevo Category → Odoo Product Category

### Reliability

- Integration job status
- attempt count
- last error
- next retry time
- external reference
- bounded exponential backoff
- dead-letter หรือ manual retry

ห้ามเรียก Odoo จาก Order Controller โดยตรง และ Odoo outage ต้องไม่ block checkout, Receipt หรือการปิดกะ

## 12. API และ Database ที่เพิ่มตามแผนใหม่

ตารางหลักที่ควรเพิ่มหรือ harden:

- `payments`
- `refunds`
- `receipts`
- `cash_sessions`
- `cash_movements`
- `sales_ledger_entries`
- `daily_closings`
- `product_modifier_groups`
- `audit_logs`
- `idempotency_keys`
- `integration_jobs`

API กลุ่มใหม่:

- `/api/payments`
- `/api/receipts`
- `/api/refunds`
- `/api/cash-sessions`
- `/api/reports/sales`
- `/api/reports/payments`
- `/api/reports/closing`
- `/api/integrations/odoo`

## 13. Testing Strategy

### Unit tests

- Pricing
- Tax and rounding
- Modifier validation
- Order transitions
- Payment state transitions
- Receipt totals
- Cash expected/count difference
- Refund limits
- Permission checks

### Integration tests

- Tenant isolation
- Order + Payment transaction
- Receipt creation
- Cash session closing
- Idempotent retry
- Outbox persistence
- Odoo outage simulation

### End-to-end tests

1. Login → select store → open shift
2. POS cash order → receipt → order history
3. Void/Refund with approval
4. Close shift → daily report
5. QR order → payment → tracking
6. Two stations → partial ready → ready
7. Offline cash order → sync without duplicate

### Definition of Done ทุก Phase

- Schema migration ทำงานบนฐานข้อมูลใหม่และฐานเดิม
- API มี schema validation และ authorization
- UI มี loading, empty, error และ success state
- มี audit/idempotency ตามความเสี่ยง
- Unit/integration/e2e tests ผ่าน
- `bun run typecheck` ผ่าน
- `bun run build` ผ่าน
- ตรวจ production smoke test หลัง deploy

## 14. Execution Order ล่าสุด

```text
Phase 0  Production Readiness
Phase 1  Catalog Hardening
Phase 2  Commerce Foundation
Phase 3  Production POS
Phase 4  Cash Session + Basic Finance
Phase 5  Realtime + Offline POS
Phase 6  QR Self-order
Phase 7  Queue
Phase 8  Preparation/KDS
Phase 9  Kiosk + Notification + Pickup
Phase 10 Advanced Store Operations
Phase 11 Odoo Adapter
```

## 15. Milestone สำหรับเปิดใช้งานร้านแรก

ต้องผ่าน Phase 0–4 ก่อนเปิดใช้หน้าร้านจริง:

- Login และ Tenant isolation ใช้ได้
- Catalog ตั้งค่าได้
- POS รับออเดอร์ได้
- รับเงินได้
- ออกและพิมพ์ใบเสร็จได้
- Void/Refund มีการควบคุมสิทธิ์
- เปิด/ปิดกะได้
- ดูยอดขายและยอดชำระได้
- Odoo ยังไม่ต้องติดตั้ง

หลังจากนั้นจึงเพิ่ม QR, Queue, KDS, Kiosk และ Odoo ตามลำดับ โดยไม่ต้องเปลี่ยน Order Engine หลัก

