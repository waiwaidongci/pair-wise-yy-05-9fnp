import { Injectable } from '@angular/core';
import { Observable, of, throwError, timer } from 'rxjs';
import { delay, mergeMap } from 'rxjs/operators';
import {
  AggregateResult,
  CellValue,
  FilterCondition,
  FilterGroup,
  FilterNode,
  GroupSummary,
  OrderChange,
  QueryRequest,
  QueryResult,
  SubmitOutcome,
  TableRow,
} from '../types/table.models';

const REGIONS = ['华东', '华南', '华北', '西南', '西北', '东北'];
const CATEGORIES = ['云服务', '智能硬件', '企业软件', '数据服务', '运维支持'];
const OWNERS = ['陈嘉', '林月', '周砺', '许宁', '韩舟', '顾清', '沈河', '陆遥'];
const STATUSES: TableRow['status'][] = ['待审核', '进行中', '已发货', '已完成', '异常'];

@Injectable({ providedIn: 'root' })
export class MockTableApiService {
  private readonly rows: TableRow[] = this.createRows(50000);
  /** 已入库的提交号：重复提交只入库一次 */
  private readonly appliedCommitIds = new Set<string>();
  /** 字段级变更台账：key 为 `订单ID::字段`，记录当前服务端值与最后提交人 */
  private readonly fieldLedger = new Map<string, { value: CellValue; commitId: string; author: string }>();
  /** 模拟网络抖动：提交有一定概率整批失败，前端可凭本地副本重试 */
  failureRate = 0.15;

  /** 提交一批（同一订单的）字段变更，按字段合并入库 */
  submitChanges(changes: OrderChange[]): Observable<SubmitOutcome[]> {
    if (Math.random() < this.failureRate) {
      return timer(180).pipe(
        mergeMap(() => throwError(() => new Error('网络超时，本批变更未送达服务器'))),
      );
    }
    const results = changes.map((change) => this.applyChange(change));
    return of(results).pipe(delay(140));
  }

  /** 模拟另一名运营在服务端改了同一字段，用于演示冲突 */
  simulateExternalEdit(orderId: string, field: keyof TableRow): void {
    const row = this.rows.find((item) => item.id === orderId);
    if (!row) {
      return;
    }
    const current = row[field];
    const next: CellValue =
      typeof current === 'number'
        ? Math.round(Number(current) * 1.1 * 100) / 100
        : `${String(current ?? '')}·改`;
    row[field] = next;
    row.updatedAt = this.now();
    this.fieldLedger.set(this.ledgerKey(orderId, field), {
      value: next,
      commitId: `external-${Date.now()}`,
      author: '林月',
    });
  }

  private applyChange(change: OrderChange): SubmitOutcome {
    // 幂等：同一 commitId 重复提交只入库一次
    if (this.appliedCommitIds.has(change.commitId)) {
      return { commitId: change.commitId, outcome: 'duplicate' };
    }
    const row = this.rows.find((item) => item.id === change.orderId);
    if (!row) {
      return { commitId: change.commitId, outcome: 'applied' };
    }
    const key = this.ledgerKey(change.orderId, change.field);
    const ledgerEntry = this.fieldLedger.get(key);
    if (ledgerEntry && ledgerEntry.value !== change.baseValue) {
      // 同一字段在本地基准之后被别人改过：保留双方版本，返回冲突
      return {
        commitId: change.commitId,
        outcome: 'conflict',
        serverValue: ledgerEntry.value,
        serverAuthor: ledgerEntry.author,
      };
    }
    // 不同字段互不干扰，逐字段合并入库
    row[change.field] = change.value;
    row.updatedAt = this.now();
    this.fieldLedger.set(key, { value: change.value, commitId: change.commitId, author: change.author });
    this.appliedCommitIds.add(change.commitId);
    return { commitId: change.commitId, outcome: 'applied' };
  }

  private ledgerKey(orderId: string, field: keyof TableRow): string {
    return `${orderId}::${String(field)}`;
  }

  private now(): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  query(request: QueryRequest): Observable<QueryResult> {
    const startedAt = performance.now();
    const filtered = this.filterRows(this.rows, request.filter, request.search);
    const sorted = this.sortRows(filtered, request.sort);
    const groups = request.groupBy ? this.groupRows(sorted, request.groupBy) : [];

    let pageRows: TableRow[];
    let total: number;

    if (request.treeMode) {
      const roots = sorted.filter((row) => row.parentId === null);
      total = roots.length;
      const rootPage = roots.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      );
      pageRows = rootPage.flatMap((root) => [
        root,
        ...(request.expandedIds.includes(root.id)
          ? sorted.filter((row) => row.parentId === root.id)
          : []),
      ]);
    } else {
      total = sorted.length;
      pageRows = sorted.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      );
    }

    const elapsedMs = Math.max(8, Math.round(performance.now() - startedAt + 18));
    return of({
      rows: pageRows,
      total,
      aggregates: this.aggregate(sorted),
      groups,
      elapsedMs,
    }).pipe(delay(request.page > 8 ? 120 : 55));
  }

  getDatasetSize(): number {
    return this.rows.length;
  }

  private filterRows(rows: TableRow[], filter: FilterGroup, search: string): TableRow[] {
    const normalizedSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesExpression = this.evaluateNode(row, filter);
      if (!matchesExpression || !normalizedSearch) {
        return matchesExpression;
      }
      return [row.orderNo, row.customer, row.region, row.category, row.owner, row.status]
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }

  private evaluateNode(row: TableRow, node: FilterNode): boolean {
    if (node.kind === 'condition') {
      return this.evaluateCondition(row, node);
    }
    if (!node.children.length) {
      return true;
    }
    return node.logic === 'and'
      ? node.children.every((child) => this.evaluateNode(row, child))
      : node.children.some((child) => this.evaluateNode(row, child));
  }

  private evaluateCondition(row: TableRow, condition: FilterCondition): boolean {
    const rawValue = row[condition.field];
    const filterValue = condition.value.trim();
    if (!filterValue) {
      return true;
    }
    if (condition.operator === 'in') {
      return filterValue.split(',').map((item) => item.trim()).includes(String(rawValue));
    }
    const left = typeof rawValue === 'number' ? rawValue : String(rawValue ?? '').toLowerCase();
    const rightNumber = Number(filterValue);
    const right = typeof rawValue === 'number' ? rightNumber : filterValue.toLowerCase();

    switch (condition.operator) {
      case 'contains':
        return String(left).includes(String(right));
      case 'equals':
        return left === right;
      case 'notEquals':
        return left !== right;
      case 'gt':
        return Number(left) > Number(right);
      case 'gte':
        return Number(left) >= Number(right);
      case 'lt':
        return Number(left) < Number(right);
      case 'lte':
        return Number(left) <= Number(right);
      default:
        return true;
    }
  }

  private sortRows(rows: TableRow[], sort: QueryRequest['sort']): TableRow[] {
    if (!sort) {
      return rows;
    }
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = left[sort.field];
      const b = right[sort.field];
      if (typeof a === 'number' && typeof b === 'number') {
        return (a - b) * direction;
      }
      return String(a).localeCompare(String(b), 'zh-CN') * direction;
    });
  }

  private groupRows(rows: TableRow[], groupBy: keyof TableRow): GroupSummary[] {
    const buckets = new Map<string, TableRow[]>();
    rows.forEach((row) => {
      const key = String(row[groupBy] ?? '未分类');
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    });
    return [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        count: bucket.length,
        aggregate: this.aggregate(bucket),
      }))
      .sort((left, right) => right.aggregate.amount - left.aggregate.amount);
  }

  private aggregate(rows: TableRow[]): AggregateResult {
    if (!rows.length) {
      return { amount: 0, quantity: 0, averageMargin: 0 };
    }
    const amount = rows.reduce((sum, row) => sum + row.amount, 0);
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const averageMargin = rows.reduce((sum, row) => sum + row.margin, 0) / rows.length;
    return {
      amount: Math.round(amount * 100) / 100,
      quantity,
      averageMargin: Math.round(averageMargin * 10) / 10,
    };
  }

  private createRows(count: number): TableRow[] {
    const rows: TableRow[] = [];
    const parentEvery = 7;
    for (let index = 0; index < count; index += 1) {
      const id = `ORD-${String(index + 1).padStart(6, '0')}`;
      const parentIndex = index % parentEvery === 0 ? null : index - (index % parentEvery);
      const day = (index * 7) % 27 + 1;
      const hour = index % 24;
      const status = STATUSES[(index * 13) % STATUSES.length];
      rows.push({
        id,
        orderNo: `SO-${String(202600000 + index).padStart(9, '0')}`,
        customer: `${['远海', '星图', '柏川', '新域', '启明', '屹辰'][index % 6]}${['科技', '制造', '物流', '能源'][index % 4]}有限公司`,
        region: REGIONS[(index * 5) % REGIONS.length],
        category: CATEGORIES[(index * 3) % CATEGORIES.length],
        owner: OWNERS[(index * 11) % OWNERS.length],
        amount: Math.round((6800 + ((index * 7919) % 940000) / 3) * 100) / 100,
        quantity: 1 + ((index * 17) % 280),
        margin: Math.round((6 + ((index * 29) % 310) / 10) * 10) / 10,
        status,
        updatedAt: `2026-09-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`,
        parentId: parentIndex === null ? null : `ORD-${String(parentIndex + 1).padStart(6, '0')}`,
      });
    }
    return rows;
  }
}
