import { permissions, type AppAccessDecision, type CatalogSnapshot, type CreateOrderInput, type OrderListItem, type OrderSummary, type QueueTicketSummary, type SessionPrincipal, type StoreSummary } from '@aevo/contracts';

export const POS_TEST_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000101';
export const POS_TEST_USER_ID = '00000000-0000-4000-8000-000000000102';
export const POS_TEST_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000103';
export const POS_TEST_STORE_ID = '00000000-0000-4000-8000-000000000110';

const categoryId = '00000000-0000-4000-8000-000000000120';
const latteId = '00000000-0000-4000-8000-000000000121';
const matchaId = '00000000-0000-4000-8000-000000000122';
const toastId = '00000000-0000-4000-8000-000000000123';

function now(): string {
  return new Date().toISOString();
}

const testPrincipal: SessionPrincipal = {
  userId: POS_TEST_USER_ID,
  email: 'pos-test@aevo.local',
  displayName: 'Aevo POS Test Operator',
  organizationId: POS_TEST_ORGANIZATION_ID,
  membershipId: POS_TEST_MEMBERSHIP_ID,
  role: 'OWNER',
  permissions: [...permissions]
};

const testStore: StoreSummary = {
  id: POS_TEST_STORE_ID,
  organizationId: POS_TEST_ORGANIZATION_ID,
  name: 'Aevo Test Store',
  code: 'TEST',
  timezone: 'Asia/Bangkok'
};

const testCatalog: CatalogSnapshot = {
  categories: [{
    id: categoryId,
    organizationId: POS_TEST_ORGANIZATION_ID,
    code: 'DRINKS',
    name: 'เครื่องดื่ม',
    slug: 'drinks',
    sortOrder: 1,
    status: 'ACTIVE'
  }],
  products: [
    {
      id: latteId,
      organizationId: POS_TEST_ORGANIZATION_ID,
      categoryId,
      sku: 'TEST-LATTE',
      name: 'Test Latte',
      description: 'In-memory POS test product',
      basePriceMinor: 6500,
      currency: 'THB',
      status: 'ACTIVE',
      variants: [],
      availability: [{ channel: 'POS', isAvailable: true, soldOut: false }]
    },
    {
      id: matchaId,
      organizationId: POS_TEST_ORGANIZATION_ID,
      categoryId,
      sku: 'TEST-MATCHA',
      name: 'Test Matcha',
      description: 'In-memory POS test product',
      basePriceMinor: 7500,
      currency: 'THB',
      status: 'ACTIVE',
      variants: [],
      availability: [{ channel: 'POS', isAvailable: true, soldOut: false }]
    },
    {
      id: toastId,
      organizationId: POS_TEST_ORGANIZATION_ID,
      categoryId,
      sku: 'TEST-TOAST',
      name: 'Test Toast',
      description: 'In-memory POS test product',
      basePriceMinor: 5500,
      currency: 'THB',
      status: 'ACTIVE',
      variants: [],
      availability: [{ channel: 'POS', isAvailable: true, soldOut: false }]
    }
  ],
  menus: [],
  modifierGroups: [],
  productModifierGroups: []
};

function access(storeId?: string): AppAccessDecision {
  return {
    allowed: true,
    application: 'POS',
    reason: 'ALLOWED',
    userId: testPrincipal.userId,
    organizationId: testPrincipal.organizationId,
    ...(storeId ? { storeId } : {}),
    role: testPrincipal.role,
    permissions: [...testPrincipal.permissions],
    checkedAt: now()
  };
}

function initialOrder(): OrderSummary {
  const createdAt = now();
  return {
    id: '00000000-0000-4000-8000-000000000130',
    organizationId: POS_TEST_ORGANIZATION_ID,
    storeId: POS_TEST_STORE_ID,
    orderNumber: 'T-0001',
    channel: 'POS',
    orderType: 'POS',
    fulfillmentType: 'TAKEAWAY',
    status: 'PAID',
    paymentStatus: 'PAID',
    currency: 'THB',
    subtotalMinor: 6500,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 6500,
    customerName: 'Test Customer',
    items: [{
      id: '00000000-0000-4000-8000-000000000131',
      lineNumber: 1,
      productId: latteId,
      sku: 'TEST-LATTE',
      productName: 'Test Latte',
      unitPriceMinor: 6500,
      quantity: 1,
      subtotalMinor: 6500,
      modifiers: []
    }],
    createdBy: POS_TEST_USER_ID,
    createdAt,
    updatedAt: createdAt
  };
}

export interface PosTestRuntime {
  readonly principal: SessionPrincipal;
  readonly stores: StoreSummary[];
  readonly catalog: CatalogSnapshot;
  access(storeId?: string): AppAccessDecision;
  listOrders(storeId: string): OrderListItem[];
  listQueue(storeId: string): QueueTicketSummary[];
  createOrder(input: CreateOrderInput): { order: OrderSummary; queueTicket: QueueTicketSummary };
  payOrder(orderId: string, input: { storeId: string; amountMinor: number; currency?: string }): { order: OrderSummary; queueTicket: QueueTicketSummary; receipt: { receiptNumber: string; orderNumber: string; totalMinor: number } };
}

export function createPosTestRuntime(): PosTestRuntime {
  const orders: OrderSummary[] = [initialOrder()];
  const queueTickets: QueueTicketSummary[] = [{
    id: '00000000-0000-4000-8000-000000000140',
    organizationId: POS_TEST_ORGANIZATION_ID,
    storeId: POS_TEST_STORE_ID,
    orderId: orders[0]!.id,
    orderNumber: orders[0]!.orderNumber,
    queueNumber: 'T-01',
    status: 'READY',
    calledAt: null,
    completedAt: null,
    createdAt: orders[0]!.createdAt
  }];

  function findStore(storeId: string): StoreSummary {
    const store = testStore.id === storeId ? testStore : undefined;
    if (!store) throw new Error('STORE_NOT_FOUND');
    return store;
  }

  function listOrders(storeId: string): OrderListItem[] {
    findStore(storeId);
    return orders.filter((order) => order.storeId === storeId).map((order) => ({
      id: order.id,
      organizationId: order.organizationId,
      storeId: order.storeId,
      orderNumber: order.orderNumber,
      channel: order.channel,
      orderType: order.orderType,
      fulfillmentType: order.fulfillmentType,
      status: order.status,
      paymentStatus: order.paymentStatus,
      currency: order.currency,
      totalMinor: order.totalMinor,
      itemCount: order.items.length,
      ...(order.scheduledPickupAt ? { scheduledPickupAt: order.scheduledPickupAt } : {}),
      ...(order.prepareAt ? { prepareAt: order.prepareAt } : {}),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    }));
  }

  function listQueue(storeId: string): QueueTicketSummary[] {
    findStore(storeId);
    return queueTickets.filter((ticket) => ticket.storeId === storeId).map((ticket) => ({ ...ticket }));
  }

  return {
    principal: testPrincipal,
    stores: [testStore],
    catalog: testCatalog,
    access,
    listOrders,
    listQueue,
    createOrder: (input) => {
      findStore(input.storeId);
      const createdAt = now();
      const items = input.items.map((inputItem, index) => {
        const product = testCatalog.products.find((candidate) => candidate.id === inputItem.productId) ?? testCatalog.products[0]!;
        return {
          id: crypto.randomUUID(),
          lineNumber: index + 1,
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          unitPriceMinor: product.basePriceMinor,
          quantity: inputItem.quantity,
          subtotalMinor: product.basePriceMinor * inputItem.quantity,
          ...(inputItem.note ? { note: inputItem.note } : {}),
          modifiers: []
        };
      });
      const totalMinor = items.reduce((sum, item) => sum + item.subtotalMinor, 0);
      const order: OrderSummary = {
        id: crypto.randomUUID(),
        organizationId: POS_TEST_ORGANIZATION_ID,
        storeId: input.storeId,
        orderNumber: `T-${String(orders.length + 1).padStart(4, '0')}`,
        channel: input.channel,
        orderType: input.orderType ?? 'POS',
        fulfillmentType: input.fulfillmentType,
        status: 'PENDING_PAYMENT',
        paymentStatus: 'UNPAID',
        currency: input.currency ?? 'THB',
        subtotalMinor: totalMinor,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor,
        ...(input.customerName ? { customerName: input.customerName } : {}),
        ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}),
        ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        items,
        createdBy: POS_TEST_USER_ID,
        createdAt,
        updatedAt: createdAt
      };
      orders.push(order);
      const queueTicket: QueueTicketSummary = {
        id: crypto.randomUUID(),
        organizationId: POS_TEST_ORGANIZATION_ID,
        storeId: input.storeId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        queueNumber: `T-${String(queueTickets.length + 1).padStart(2, '0')}`,
        status: 'WAITING',
        calledAt: null,
        completedAt: null,
        createdAt
      };
      queueTickets.push(queueTicket);
      return { order: { ...order, items: [...order.items] }, queueTicket: { ...queueTicket } };
    },
    payOrder: (orderId, input) => {
      findStore(input.storeId);
      const order = orders.find((candidate) => candidate.id === orderId && candidate.storeId === input.storeId);
      if (!order) throw new Error('ORDER_NOT_FOUND');
      order.status = 'PAID';
      order.paymentStatus = 'PAID';
      order.updatedAt = now();
      const queueTicket = queueTickets.find((ticket) => ticket.orderId === order.id);
      if (!queueTicket) throw new Error('QUEUE_TICKET_NOT_FOUND');
      queueTicket.status = 'WAITING';
      return {
        order: { ...order, items: [...order.items] },
        queueTicket: { ...queueTicket },
        receipt: { receiptNumber: `R-${order.orderNumber}`, orderNumber: order.orderNumber, totalMinor: order.totalMinor }
      };
    }
  };
}
