import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  AggregateResult,
  CellValue,
  ChangeCommit,
  CommitConflict,
  CommitSyncResult,
  FilterCondition,
  FilterGroup,
  FilterNode,
  GroupSummary,
  QueryRequest,
  QueryResult,
  TableRow,
} from '../types/table.models';
import { NetworkService } from '../services/network.service';

const REGIONS = ['华东', '华南', '华北', '西南', '西北', '东北'];
const CATEGORIES = ['云服务', '智能硬件', '企业软件', '数据服务', '运维支持'];
const OWNERS = ['陈嘉', '林月', '周砺', '许宁', '韩舟', '顾清', '沈河', '陆遥'];
const STATUSES: TableRow['status'][] = ['待审核', '进行中', '已发货', '已完成', '异常'];

const PROCESSED_COMMITS_KEY = 'pair-wise-yy-05:processed-commits';
const COMMITTED_OVERRIDES_KEY = 'pair-wise-yy-05:committed-overrides';

@Injectable({ providedIn: 'root' })
export class MockTableApiService {
  private readonly network = inject(NetworkService);
  private readonly rows: TableRow[] = this.createRows(50000);
  /** 服务端已入库的字段覆盖（服务端副本，跨刷新保留） */
  private readonly committedOverrides: Record<string, CellValue> = this.loadCommittedOverrides();
  /** 演示用：强制提交失败 */
  private forceFailure = false;

  constructor() {
    this.applyCommittedOverrides();
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

  /**
   * 处理一批变更提交（已按订单号合并）。
   * - 幂等：同一提交号只入库一次，重复提交返回 duplicated。
   * - 不同字段可合并：仅合并非冲突字段。
   * - 同字段冲突：保留本地与服务端双方版本，不覆盖。
   */
  commit(commits: ChangeCommit[]): Observable<CommitSyncResult[]> {
    if (!this.network.isOnline) {
      return throwError(() => new Error('网络已断开，提交未发出'));
    }
    if (this.forceFailure) {
      return throwError(() => new Error('模拟提交失败：服务端暂时不可用'));
    }
    const processed = this.loadProcessedCommitIds();
    const results: CommitSyncResult[] = commits.map((commit) => {
      if (processed.has(commit.id)) {
        return { commitId: commit.id, status: 'synced', duplicated: true };
      }
      const row = this.rows.find((item) => item.id === commit.orderId);
      const conflicts: CommitConflict[] = [];
      if (row) {
        for (const change of commit.changes) {
          const current = row[change.field];
          if (current !== change.baseValue) {
            conflicts.push({
              field: change.field,
              baseValue: change.baseValue,
              localValue: change.newValue,
              remoteValue: current,
            });
          }
        }
      }
      if (conflicts.length) {
        if (row) {
          for (const change of commit.changes) {
            if (!conflicts.some((item) => item.field === change.field)) {
              row[change.field] = change.newValue;
              this.committedOverrides[`${commit.orderId}::${String(change.field)}`] = change.newValue;
            }
          }
        }
        return { commitId: commit.id, status: 'conflict', conflicts };
      }
      if (row) {
        for (const change of commit.changes) {
          row[change.field] = change.newValue;
          this.committedOverrides[`${commit.orderId}::${String(change.field)}`] = change.newValue;
        }
      }
      processed.add(commit.id);
      return { commitId: commit.id, status: 'synced' };
    });
    this.saveProcessedCommitIds(processed);
    this.saveCommittedOverrides();
    return of(results).pipe(delay(60));
  }

  setForceFailure(force: boolean): void {
    this.forceFailure = force;
  }

  isForceFailure(): boolean {
    return this.forceFailure;
  }

  getDatasetSize(): number {
    return this.rows.length;
  }

  private applyCommittedOverrides(): void {
    for (const [key, value] of Object.entries(this.committedOverrides)) {
      const [orderId, field] = key.split('::');
      const row = this.rows.find((item) => item.id === orderId);
      if (row) {
        row[field] = value;
      }
    }
  }

  private loadProcessedCommitIds(): Set<string> {
    try {
      const raw = localStorage.getItem(PROCESSED_COMMITS_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  private saveProcessedCommitIds(ids: Set<string>): void {
    try {
      localStorage.setItem(PROCESSED_COMMITS_KEY, JSON.stringify([...ids]));
    } catch {
      // 忽略副本写入失败
    }
  }

  private loadCommittedOverrides(): Record<string, CellValue> {
    try {
      const raw = localStorage.getItem(COMMITTED_OVERRIDES_KEY);
      return raw ? (JSON.parse(raw) as Record<string, CellValue>) : {};
    } catch {
      return {};
    }
  }

  private saveCommittedOverrides(): void {
    try {
      localStorage.setItem(COMMITTED_OVERRIDES_KEY, JSON.stringify(this.committedOverrides));
    } catch {
      // 忽略副本写入失败
    }
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
