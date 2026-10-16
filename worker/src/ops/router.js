// /api/ops/* for signed-in staff (the role checks are inside each function, in the Worker), and
// the customer's bill link /api/guest/bill/*. Returns a handler result, or undefined if no route.
import * as stock from './stock.js';
import * as tabs from './tabs.js';
import * as cash from './cash.js';
import * as approvals from './approvals.js';
import * as front from './frontoffice.js';
import * as closing from './closing.js';

export async function opsRoute(m, p, u, b, env, user) {
  const q = k => u.searchParams.get(k) || undefined;
  if (m === 'GET') {
    switch (p) {
      case '/api/ops/products': return stock.listProducts(env, user);
      case '/api/ops/stock': return stock.stockSheet(env, { stationId: q('stationId'), date: q('date') }, user);
      case '/api/ops/changes': return stock.changeLog(env, user);
      case '/api/ops/tabs': return tabs.myTabs(env, user, { all: q('all') === '1' });
      case '/api/ops/tabs/find': return tabs.findTabs(env, user, q('q'));
      case '/api/ops/tab': return tabs.getTab(env, user, q('id'));
      case '/api/ops/bar/rounds': return tabs.barRounds(env, user, { stationId: q('stationId') });
      case '/api/ops/cash': return cash.myCash(env, user, { date: q('date') });
      case '/api/ops/cash/all': return cash.cashSessions(env, user, { date: q('date') });
      case '/api/ops/approvals': return approvals.listApprovals(env, user, { status: q('status') });
      case '/api/ops/tables': return front.tablesTonight(env, user, { date: q('date') });
      case '/api/ops/incidents': return front.listIncidents(env, user, { date: q('date') });
      case '/api/ops/my-report': return closing.myReport(env, user, { date: q('date') });
      case '/api/ops/front-report': return closing.frontOfficeReport(env, user, { date: q('date') });
      case '/api/ops/sales': return closing.todaySales(env, user, { date: q('date') });
      case '/api/ops/closing': return closing.closingStatus(env, user, { date: q('date') });
      case '/api/ops/eod': return closing.eodReport(env, user, { date: q('date') });
      case '/api/ops/eod/list': return closing.listEod(env, user);
      case '/api/ops/finance-contact': return closing.financeContact(env, user);
    }
    return undefined;
  }
  if (m !== 'POST') return undefined;
  switch (p) {
    case '/api/ops/products': return stock.saveProduct(env, b, user);
    case '/api/ops/products/available': return stock.setAvailable(env, b, user);
    case '/api/ops/stock/received': return stock.recordReceived(env, b, user);
    case '/api/ops/stock/transfer': return stock.recordTransfer(env, b, user);
    case '/api/ops/stock/waste': return stock.recordWaste(env, b, user);
    case '/api/ops/stock/count': return stock.submitCount(env, b, user);
    case '/api/ops/stock/review': return stock.reviewCount(env, b, user);
    case '/api/ops/tabs/open': return tabs.openTab(env, b, user);
    case '/api/ops/tabs/round': return tabs.addRound(env, b, user);
    case '/api/ops/tabs/round-action': return tabs.waiterRound(env, b, user);
    case '/api/ops/tabs/cash': return tabs.recordCash(env, b, user);
    case '/api/ops/tabs/close': return tabs.closeTab(env, b, user);
    case '/api/ops/tabs/text-bill': return tabs.textBill(env, b, user);
    case '/api/ops/bar/round': return tabs.barRound(env, b, user);
    case '/api/ops/cash/open': return cash.openCash(env, b, user);
    case '/api/ops/cash/move': return cash.cashMovement(env, b, user);
    case '/api/ops/cash/close': return cash.closeCash(env, b, user);
    case '/api/ops/cash/review': return cash.reviewCash(env, b, user);
    case '/api/ops/approvals/request': return approvals.requestApproval(env, b, user);
    case '/api/ops/approvals/decide': return approvals.decideApproval(env, b, user);
    case '/api/ops/tables': return front.updateTableBooking(env, b, user);
    case '/api/ops/incidents': return front.addIncident(env, b, user);
    case '/api/ops/incidents/update': return front.updateIncident(env, b, user);
    case '/api/ops/my-report': return closing.submitMyReport(env, b, user);
    case '/api/ops/front-report': return closing.submitFrontOffice(env, b, user);
    case '/api/ops/close-night': return closing.closeNight(env, b, user);
    case '/api/ops/eod/sign-off': return closing.financeSignOff(env, b, user);
    case '/api/ops/finance-contact': return closing.financeContact(env, user, b || {});
  }
  return undefined;
}
