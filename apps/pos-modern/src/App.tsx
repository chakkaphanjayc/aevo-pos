import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CatalogSnapshot,
  CreateOrderInput,
  ModifierGroupSummary,
  OrderListItem,
  OrderSummary,
  ProductSummary,
  ProductVariantSummary,
  QueueTicketSummary,
  SessionPrincipal,
  StoreSummary
} from '@aevo/contracts';
import {
  addItem,
  cartTotals,
  clearCart,
  createEmptyCart,
  effectivePrice,
  formatMoney,
  getProductModifierGroups,
  lineTotal,
  removeItem,
  setCustomer,
  setFulfillmentType,
  updateQuantity,
  type Cart,
  type CartItem,
  type CartItemModifier
} from '@aevo/ordering';
import {
  createStaffOrder,
  getAccess,
  getCatalog,
  getContext,
  getOrders,
  getQueue,
  getSession,
  getStores,
  payStaffOrder,
  PosApiError,
  type AccessResponse,
  type PayOrderResponse
} from './api';
import { loadDraft, saveDraft } from './idb';

type ScreenState = 'loading' | 'ready' | 'denied' | 'error';

function redirectToHubLogin(): void {
  const returnPath = `${window.location.pathname}${window.location.search}`;
  const target = new URL('/api/auth/start', window.location.origin);
  target.searchParams.set('returnTo', returnPath);
  window.location.assign(target.toString());
}

function errorMessage(error: unknown): string {
  if (error instanceof PosApiError) {
    if (error.status === 401) return 'เซสชันหมดอายุ กำลังพากลับไปเข้าสู่ระบบ';
    if (error.status === 503) return 'ฐานข้อมูลยังไม่พร้อม กรุณาใช้ migration ล่าสุดก่อนเปิด Aevo POS';
    return error.message;
  }
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
}

function isAvailable(product: ProductSummary): boolean {
  if (product.status !== 'ACTIVE') return false;
  const rule = product.availability.find((availability) => availability.channel === 'POS');
  return !rule || rule.isAvailable && !rule.soldOut;
}

function statusTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (['PAID', 'CONFIRMED', 'READY', 'COMPLETED'].includes(status)) return 'success';
  if (['CANCELLED', 'REFUNDED'].includes(status)) return 'danger';
  if (['PENDING_PAYMENT', 'PREPARING', 'QUEUED', 'ACCEPTED'].includes(status)) return 'warning';
  return 'neutral';
}

function createCartItem(product: ProductSummary, variant: ProductVariantSummary | undefined, modifiers: CartItemModifier[]): CartItem {
  return {
    id: crypto.randomUUID(),
    productId: product.id,
    ...(variant ? { variantId: variant.id, variantName: variant.name } : {}),
    productName: product.name,
    modifiers,
    unitPriceMinor: effectivePrice(product, variant),
    quantity: 1,
    note: ''
  };
}

export function App() {
  const [screen, setScreen] = useState<ScreenState>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<SessionPrincipal | null>(null);
  const [access, setAccess] = useState<AccessResponse | null>(null);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [storeId, setStoreId] = useState<string>(() => localStorage.getItem('aevo-pos-modern-store') || '');
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [cart, setCart] = useState<Cart>(createEmptyCart);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [queue, setQueue] = useState<QueueTicketSummary[]>([]);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState<ProductSummary | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(undefined);
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({});
  const [paymentOrder, setPaymentOrder] = useState<OrderSummary | null>(null);
  const [paymentResult, setPaymentResult] = useState<PayOrderResponse | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const totals = useMemo(() => cartTotals(cart), [cart]);

  const handleAuthError = useCallback((error: unknown): boolean => {
    if (error instanceof PosApiError && error.status === 401) {
      setMessage('เซสชันหมดอายุ กำลังพากลับไปเข้าสู่ระบบ');
      window.setTimeout(redirectToHubLogin, 350);
      return true;
    }
    return false;
  }, []);

  const refreshStoreData = useCallback(async (selectedStoreId: string): Promise<void> => {
    const [nextCatalog, nextOrders, nextQueue] = await Promise.all([
      getCatalog(selectedStoreId),
      getOrders(selectedStoreId),
      getQueue(selectedStoreId)
    ]);
    setCatalog(nextCatalog);
    setOrders(nextOrders.orders);
    setQueue(nextQueue.tickets);
  }, []);

  const selectStore = useCallback(async (nextStoreId: string, restoreDraft = true): Promise<void> => {
    setMessage(null);
    setScreen('loading');
    try {
      const nextAccess = await getAccess(nextStoreId);
      setAccess(nextAccess);
      if (!nextAccess.allowed) {
        setScreen('denied');
        return;
      }
      const context = await getContext(nextStoreId);
      setPrincipal(context.principal);
      setStoreId(nextStoreId);
      localStorage.setItem('aevo-pos-modern-store', nextStoreId);
      await refreshStoreData(nextStoreId);
      if (restoreDraft) {
        const draft = await loadDraft(nextStoreId);
        if (draft) setCart(draft);
      }
      setScreen('ready');
    } catch (error) {
      if (handleAuthError(error)) return;
      setMessage(errorMessage(error));
      setScreen('error');
    }
  }, [handleAuthError, refreshStoreData]);

  useEffect(() => {
    let cancelled = false;
    const boot = async (): Promise<void> => {
      try {
        const nextAccess = await getAccess();
        if (cancelled) return;
        setAccess(nextAccess);
        if (!nextAccess.allowed) {
          setScreen('denied');
          return;
        }
        const session = await getSession();
        if (cancelled) return;
        setPrincipal(session.user);
        const storeResponse = await getStores();
        if (cancelled) return;
        setStores(storeResponse.stores);
        const preferredStore = storeResponse.stores.find((store) => store.id === storeId)?.id || storeResponse.stores[0]?.id;
        if (!preferredStore) {
          setScreen('ready');
          return;
        }
        await selectStore(preferredStore);
      } catch (error) {
        if (cancelled) return;
        if (handleAuthError(error)) return;
        setMessage(errorMessage(error));
        setScreen('error');
      }
    };
    void boot();
    return () => { cancelled = true; };
  }, [handleAuthError, selectStore, storeId]);

  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => { window.removeEventListener('online', onlineHandler); window.removeEventListener('offline', offlineHandler); };
  }, []);

  useEffect(() => {
    if (storeId) void saveDraft(storeId, cart);
  }, [cart, storeId]);

  const productModifierMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const mapping of catalog?.productModifierGroups ?? []) {
      map.set(mapping.productId, [...(map.get(mapping.productId) ?? []), mapping.modifierGroupId]);
    }
    return map;
  }, [catalog]);
  const categories = useMemo(() => catalog?.categories.filter((category) => category.status === 'ACTIVE').sort((left, right) => left.sortOrder - right.sortOrder) ?? [], [catalog]);
  const products = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (catalog?.products ?? []).filter((product) => {
      const categoryMatch = categoryId === 'all' || product.categoryId === categoryId;
      const queryMatch = !normalizedQuery || product.name.toLowerCase().includes(normalizedQuery) || product.sku.toLowerCase().includes(normalizedQuery);
      return categoryMatch && queryMatch;
    });
  }, [catalog, categoryId, query]);

  function addSelectedProduct(): void {
    if (!selectedProduct || !catalog) return;
    const groups = getProductModifierGroups(selectedProduct.id, productModifierMap, catalog.modifierGroups);
    if (groups.some((group) => (selectedModifiers[group.id] ?? []).length < group.minSelections)) {
      setMessage('กรุณาเลือก modifier ที่จำเป็นให้ครบ');
      return;
    }
    const modifiers = groups.flatMap((group) => (selectedModifiers[group.id] ?? []).map((modifierId) => {
      const modifier = group.modifiers.find((candidate) => candidate.id === modifierId);
      return modifier ? { modifierId: modifier.id, modifierGroupId: group.id, name: modifier.name, priceDeltaMinor: modifier.priceDeltaMinor } : null;
    }).filter((modifier): modifier is CartItemModifier => modifier !== null));
    const variant = selectedProduct.variants.find((candidate) => candidate.id === selectedVariantId);
    setCart((current) => addItem(current, createCartItem(selectedProduct, variant, modifiers)));
    setSelectedProduct(null);
    setSelectedModifiers({});
    setMessage(null);
  }

  function openProduct(product: ProductSummary): void {
    const groups = getProductModifierGroups(product.id, productModifierMap, catalog?.modifierGroups ?? []);
    const firstVariant = product.variants[0];
    setSelectedProduct(product);
    setSelectedVariantId(firstVariant?.id);
    setSelectedModifiers(Object.fromEntries(groups.map((group) => [group.id, []])));
    if (groups.length === 0 && product.variants.length <= 1) {
      setCart((current) => addItem(current, createCartItem(product, firstVariant, [])));
      setSelectedProduct(null);
    }
  }

  function toggleModifier(group: ModifierGroupSummary, modifierId: string): void {
    setSelectedModifiers((current) => {
      const selected = current[group.id] ?? [];
      if (group.selectionType === 'SINGLE') return { ...current, [group.id]: selected.includes(modifierId) ? [] : [modifierId] };
      if (selected.includes(modifierId)) return { ...current, [group.id]: selected.filter((id) => id !== modifierId) };
      if (selected.length >= group.maxSelections) return current;
      return { ...current, [group.id]: [...selected, modifierId] };
    });
  }

  async function beginPayment(): Promise<void> {
    if (!storeId || cart.items.length === 0) return;
    if (!online) { setMessage('ออฟไลน์อยู่: Aevo POS ไม่อนุญาตให้ยืนยันการชำระเงิน'); return; }
    try {
      const currency = catalog?.products[0]?.currency || 'THB';
      const input: CreateOrderInput & { orderType: 'POS' } = {
        storeId,
        channel: 'POS',
        orderType: 'POS',
        fulfillmentType: cart.fulfillmentType,
        currency,
        ...(cart.customerName ? { customerName: cart.customerName } : {}),
        ...(cart.customerPhone ? { customerPhone: cart.customerPhone } : {}),
        ...(cart.notes ? { notes: cart.notes } : {}),
        items: cart.items.map((item) => ({
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          ...(item.modifiers.length ? { modifierIds: item.modifiers.map((modifier) => modifier.modifierId) } : {}),
          quantity: item.quantity,
          ...(item.note ? { note: item.note } : {})
        }))
      };
      const response = await createStaffOrder(input, crypto.randomUUID());
      setPaymentOrder(response.order);
      setPaymentResult(null);
      setCashReceived((response.order.totalMinor / 100).toFixed(2));
      setMessage(null);
    } catch (error) {
      if (handleAuthError(error)) return;
      setMessage(errorMessage(error));
    }
  }

  async function confirmPayment(): Promise<void> {
    if (!paymentOrder || !storeId) return;
    const receivedMinor = Math.round(Number(cashReceived) * 100);
    if (!Number.isFinite(receivedMinor) || receivedMinor < paymentOrder.totalMinor) {
      setMessage('จำนวนเงินที่รับมาต้องไม่น้อยกว่ายอดชำระ');
      return;
    }
    try {
      const response = await payStaffOrder(paymentOrder.id, { storeId, method: 'CASH', amountMinor: paymentOrder.totalMinor, currency: paymentOrder.currency }, crypto.randomUUID());
      setPaymentResult(response);
      setCart((current) => clearCart(current));
      setPaymentOrder(null);
      await refreshStoreData(storeId);
      setMessage(`ชำระเงินสำเร็จ · เงินทอน ${formatMoney(receivedMinor - paymentOrder.totalMinor, paymentOrder.currency)}`);
    } catch (error) {
      if (handleAuthError(error)) return;
      setMessage(errorMessage(error));
    }
  }

  if (screen === 'loading') return <LoadingScreen />;
  if (screen === 'denied') return <DeniedScreen access={access} />;
  if (screen === 'error') return <ErrorScreen message={message || 'ไม่สามารถเปิด Aevo POS ได้'} onRetry={() => window.location.reload()} />;

  const selectedGroups = selectedProduct && catalog ? getProductModifierGroups(selectedProduct.id, productModifierMap, catalog.modifierGroups) : [];
  const selectedVariant = selectedProduct?.variants.find((variant) => variant.id === selectedVariantId);
  const receivedMinor = Math.round(Number(cashReceived || 0) * 100);

  return (
    <div className="pos-app">
      <a className="pos-skip-link" href="#pos-main">ข้ามไปเนื้อหา</a>
      <header className="pos-header">
        <div className="pos-brand"><span className="pos-brand__mark">A</span><span><strong>Aevo POS</strong><small>Cloud authority</small></span></div>
        <div className="pos-header__context">
          <label className="pos-store-select"><span>ร้าน</span><select value={storeId} onChange={(event) => void selectStore(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.code}</option>)}</select></label>
          <span className={`pos-connection ${online ? 'is-online' : 'is-offline'}`}><i aria-hidden="true" />{online ? 'ออนไลน์' : 'ออฟไลน์'}</span>
        </div>
      </header>
      {access?.testMode ? <div className="pos-test-banner" role="status">โหมดทดสอบ · เข้าได้โดยไม่ต้องเข้าสู่ระบบ · ข้อมูลจะอยู่ในหน่วยความจำและหายเมื่อ restart</div> : null}
      <div className="pos-access-strip"><span>{principal?.displayName || principal?.email || 'ผู้ปฏิบัติงาน'}</span><span>{access?.role || principal?.role || '—'}</span><span>{access?.permissions.length || 0} permissions</span>{!online ? <strong>ดู draft ได้ แต่การสร้าง order/payment ถูกปิด</strong> : null}</div>
      {message ? <div className="pos-toast" role="status">{message}</div> : null}
      <main id="pos-main" className="pos-workspace">
        <section className="pos-menu-panel">
          <div className="pos-heading"><div><span className="pos-eyebrow">Point of sale</span><h1>เลือกสินค้า</h1><p>{catalog?.products.length || 0} รายการ · ราคาจาก catalog กลาง</p></div><label className="pos-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อหรือ SKU" /></label></div>
          <nav className="pos-categories" aria-label="หมวดหมู่"><button className={categoryId === 'all' ? 'is-active' : ''} type="button" onClick={() => setCategoryId('all')}>ทั้งหมด</button>{categories.map((category) => <button className={categoryId === category.id ? 'is-active' : ''} type="button" key={category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</nav>
          <div className="pos-product-grid">{products.map((product) => { const available = isAvailable(product); const variant = product.variants[0]; return <button className={`pos-product-card ${available ? '' : 'is-disabled'}`} disabled={!available} type="button" key={product.id} onClick={() => openProduct(product)}><span className="pos-product-card__image" aria-hidden="true">{product.name.slice(0, 1)}</span><span className="pos-product-card__body"><strong>{product.name}</strong><small>{product.sku} · {product.variants.length > 1 ? `${product.variants.length} variants` : 'standard'}</small><span>{formatMoney(effectivePrice(product, variant), product.currency)}</span></span>{!available ? <em>หมด/ปิดขาย</em> : null}</button>; })}</div>{products.length === 0 ? <div className="pos-empty"><strong>ไม่พบสินค้า</strong><p>ลองค้นหาคำอื่นหรือเลือกหมวดหมู่ทั้งหมด</p></div> : null}
        </section>
        <aside className="pos-cart-panel" aria-label="ตะกร้า">
          <div className="pos-cart-heading"><div><span className="pos-eyebrow">Current order</span><h2>ตะกร้า</h2></div><button type="button" className="pos-clear" onClick={() => setCart((current) => clearCart(current))} disabled={cart.items.length === 0}>ล้าง</button></div>
          <div className="pos-cart-items">{cart.items.length ? cart.items.map((item) => <div className="pos-cart-item" key={item.id}><div><strong>{item.productName}</strong>{item.variantName ? <small>{item.variantName}</small> : null}{item.modifiers.length ? <small>{item.modifiers.map((modifier) => modifier.name).join(' · ')}</small> : null}</div><div className="pos-cart-item__controls"><button type="button" onClick={() => setCart((current) => updateQuantity(current, item.id, item.quantity - 1))}>−</button><span>{item.quantity}</span><button type="button" onClick={() => setCart((current) => updateQuantity(current, item.id, item.quantity + 1))}>+</button><strong>{formatMoney(lineTotal(item), catalog?.products[0]?.currency || 'THB')}</strong><button type="button" className="pos-remove" onClick={() => setCart((current) => removeItem(current, item.id))} aria-label={`ลบ ${item.productName}`}>×</button></div></div>) : <div className="pos-cart-empty"><span>＋</span><strong>ยังไม่มีสินค้า</strong><p>เลือกสินค้าจากเมนูเพื่อเริ่มออเดอร์</p></div>}</div>
          <div className="pos-cart-footer"><div className="pos-fulfillment"><span>รูปแบบการรับ</span><button className={cart.fulfillmentType === 'TAKEAWAY' ? 'is-active' : ''} type="button" onClick={() => setCart((current) => setFulfillmentType(current, 'TAKEAWAY'))}>ซื้อกลับ</button><button className={cart.fulfillmentType === 'DINE_IN' ? 'is-active' : ''} type="button" onClick={() => setCart((current) => setFulfillmentType(current, 'DINE_IN'))}>ทานที่ร้าน</button></div><label className="pos-field"><span>ชื่อลูกค้า <small>ไม่บังคับ</small></span><input value={cart.customerName} onChange={(event) => setCart((current) => setCustomer(current, event.target.value, current.customerPhone))} maxLength={160} placeholder="เช่น คุณเมย์" /></label><div className="pos-total-line"><span>ยอดสินค้า</span><strong>{formatMoney(totals.subtotalMinor, catalog?.products[0]?.currency || 'THB')}</strong></div><div className="pos-total-line pos-total-final"><span>ยอดชำระ</span><strong>{formatMoney(totals.totalMinor, catalog?.products[0]?.currency || 'THB')}</strong></div><button className="pos-pay-button" type="button" onClick={() => void beginPayment()} disabled={!online || cart.items.length === 0}>{online ? 'รับชำระเงินสด' : 'ออฟไลน์ · ชำระเงินไม่ได้'}</button><p className="pos-authority-note">สร้าง order, ราคา, permission และ payment ที่ Core API เป็นผู้ตัดสิน</p></div>
        </aside>
      </main>
      <section className="pos-ops-grid"><div className="pos-ops-card"><div className="pos-ops-heading"><div><span className="pos-eyebrow">Queue</span><h2>สถานะคิว</h2></div><button type="button" onClick={() => { if (storeId) void getQueue(storeId).then((response) => setQueue(response.tickets)); }}>รีเฟรช</button></div>{queue.length ? <ul className="pos-simple-list">{queue.slice(0, 6).map((ticket) => <li key={ticket.id}><span><strong>{ticket.queueNumber}</strong><small>{ticket.orderNumber || ticket.orderId.slice(0, 8)}</small></span><span className={`pos-status pos-status--${statusTone(ticket.status)}`}>{ticket.status}</span></li>)}</ul> : <p className="pos-muted">ยังไม่มีคิวที่กำลังดำเนินการ</p>}</div><div className="pos-ops-card"><div className="pos-ops-heading"><div><span className="pos-eyebrow">Recent orders</span><h2>ออเดอร์ล่าสุด</h2></div><button type="button" onClick={() => { if (storeId) void getOrders(storeId).then((response) => setOrders(response.orders)); }}>รีเฟรช</button></div>{orders.length ? <ul className="pos-simple-list">{orders.slice(0, 6).map((order) => <li key={order.id}><span><strong>{order.orderNumber}</strong><small>{formatMoney(order.totalMinor, order.currency)} · {new Date(order.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</small></span><span className={`pos-status pos-status--${statusTone(order.status)}`}>{order.status}</span></li>)}</ul> : <p className="pos-muted">ยังไม่มีออเดอร์</p>}</div></section>
      {selectedProduct ? <div className="pos-overlay" role="dialog" aria-modal="true" aria-label={`ปรับแต่ง ${selectedProduct.name}`}><div className="pos-modal"><div className="pos-modal__heading"><div><span className="pos-eyebrow">Customize item</span><h2>{selectedProduct.name}</h2></div><button type="button" onClick={() => setSelectedProduct(null)} aria-label="ปิด">×</button></div>{selectedProduct.variants.length > 1 ? <label className="pos-field"><span>ขนาด/ตัวเลือก</span><select value={selectedVariantId || ''} onChange={(event) => setSelectedVariantId(event.target.value)}>{selectedProduct.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {formatMoney(variant.priceMinor, selectedProduct.currency)}</option>)}</select></label> : null}{selectedGroups.map((group) => <fieldset className="pos-modifier-group" key={group.id}><legend>{group.name} {group.required ? <small>จำเป็น</small> : null}</legend>{group.modifiers.map((modifier) => <label className="pos-check-row" key={modifier.id}><input type={group.selectionType === 'SINGLE' ? 'radio' : 'checkbox'} name={group.id} checked={(selectedModifiers[group.id] ?? []).includes(modifier.id)} onChange={() => toggleModifier(group, modifier.id)} /><span>{modifier.name}</span><small>{modifier.priceDeltaMinor ? `+${formatMoney(modifier.priceDeltaMinor, selectedProduct.currency)}` : 'ไม่เพิ่ม'}</small></label>)}</fieldset>)}<div className="pos-modal__footer"><span>{formatMoney(effectivePrice(selectedProduct, selectedVariant), selectedProduct.currency)}</span><button className="pos-pay-button" type="button" onClick={addSelectedProduct}>เพิ่มลงตะกร้า</button></div></div></div> : null}
      {paymentOrder ? <div className="pos-overlay" role="dialog" aria-modal="true" aria-label="รับชำระเงิน"><div className="pos-modal pos-payment-modal"><div className="pos-modal__heading"><div><span className="pos-eyebrow">Cash payment</span><h2>รับเงินสด</h2></div><button type="button" onClick={() => setPaymentOrder(null)} aria-label="ปิด">×</button></div><p className="pos-payment-total">{formatMoney(paymentOrder.totalMinor, paymentOrder.currency)}</p><label className="pos-field"><span>เงินที่รับมา ({paymentOrder.currency})</span><input autoFocus type="number" min={paymentOrder.totalMinor / 100} step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} /></label><div className="pos-change-line"><span>เงินทอน</span><strong>{formatMoney(Math.max(0, receivedMinor - paymentOrder.totalMinor), paymentOrder.currency)}</strong></div><button className="pos-pay-button" type="button" onClick={() => void confirmPayment()} disabled={!online}>ยืนยันการชำระเงิน</button></div></div> : null}
      {paymentResult ? <div className="pos-overlay" role="dialog" aria-modal="true" aria-label="ใบเสร็จ"><div className="pos-modal"><div className="pos-modal__heading"><div><span className="pos-eyebrow">Payment complete</span><h2>ชำระเงินสำเร็จ</h2></div><button type="button" onClick={() => setPaymentResult(null)} aria-label="ปิด">×</button></div><div className="pos-receipt"><strong>{paymentResult.receipt?.receiptNumber || paymentResult.order.orderNumber}</strong><span>ออเดอร์ {paymentResult.order.orderNumber}</span><span>คิว {paymentResult.queueTicket?.queueNumber || 'กำลังจัดคิว'}</span><strong>{formatMoney(paymentResult.order.totalMinor, paymentResult.order.currency)}</strong></div><button className="pos-pay-button" type="button" onClick={() => setPaymentResult(null)}>ออเดอร์ใหม่</button></div></div> : null}
    </div>
  );
}

function LoadingScreen() {
  return <main className="pos-state-screen"><div className="pos-state-card"><span className="pos-spinner" aria-hidden="true">◌</span><h1>กำลังเปิด Aevo POS</h1><p>กำลังตรวจ session, assignment และ store scope จาก Core API</p></div></main>;
}

function DeniedScreen({ access }: { access: AccessResponse | null }) {
  return <main className="pos-state-screen"><div className="pos-state-card"><span className="pos-status pos-status--danger">Access denied</span><h1>บัญชีนี้ยังเข้า POS ไม่ได้</h1><p>เซิร์ฟเวอร์ตรวจสอบแล้ว แต่ยังไม่พบ active POS assignment หรือ store scope ที่ใช้งานได้{access ? ` (${access.reason})` : ''}</p><a className="pos-secondary-button" href="/api/auth/start?returnTo=%2F">กลับไป Aevo Hub</a></div></main>;
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="pos-state-screen"><div className="pos-state-card"><span className="pos-status pos-status--danger">Unavailable</span><h1>เปิด Aevo POS ไม่สำเร็จ</h1><p>{message}</p><button className="pos-secondary-button" type="button" onClick={onRetry}>ลองอีกครั้ง</button></div></main>;
}
