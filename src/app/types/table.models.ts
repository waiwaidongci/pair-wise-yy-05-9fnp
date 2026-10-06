export type CellValue = string | number | boolean | null;

export interface TableRow {
  id: string;
  orderNo: string;
  customer: string;
  region: string;
  category: string;
  owner: string;
  amount: number;
  quantity: number;
  margin: number;
  status: '待审核' | '进行中' | '已发货' | '已完成' | '异常';
  updatedAt: string;
  parentId: string | null;
  [key: string]: CellValue;
}

export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in';

export interface FilterCondition {
  kind: 'condition';
  id: string;
  field: keyof TableRow;
  operator: FilterOperator;
  value: string;
}

export interface FilterGroup {
  kind: 'group';
  id: string;
  logic: 'and' | 'or';
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: keyof TableRow;
  direction: SortDirection;
}

export interface ColumnDefinition {
  key: keyof TableRow;
  label: string;
  width: number;
  minWidth: number;
  align?: 'left' | 'right' | 'center';
  editable?: boolean;
  formatter?: 'currency' | 'percent' | 'date' | 'status';
  type: 'text' | 'number' | 'date' | 'enum' | 'boolean';
}

export interface QueryRequest {
  page: number;
  pageSize: number;
  sort: SortState | null;
  filter: FilterGroup;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
  expandedIds: string[];
  search: string;
}

export interface AggregateResult {
  amount: number;
  quantity: number;
  averageMargin: number;
}

export interface GroupSummary {
  key: string;
  count: number;
  aggregate: AggregateResult;
}

export interface QueryResult {
  rows: TableRow[];
  total: number;
  aggregates: AggregateResult;
  groups: GroupSummary[];
  elapsedMs: number;
}

export interface SavedView {
  id: string;
  name: string;
  createdAt: string;
  pageSize: number;
  visibleColumns: Array<keyof TableRow>;
  columnWidths: Record<string, number>;
  pinnedColumns: Array<keyof TableRow>;
  sort: SortState | null;
  filter: FilterGroup;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
}

/**
 * 变更提交状态
 * - pending: 待提交（本地已改，尚未同步）
 * - syncing: 同步中
 * - synced: 已入库
 * - conflict: 同字段冲突，保留双方版本待处理
 * - failed: 提交失败，可从副本重试
 */
export type CommitStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';

/** 单个字段的变更：记录字段与本地基准值 */
export interface FieldChange {
  field: keyof TableRow;
  baseValue: CellValue;
  newValue: CellValue;
}

/** 同字段冲突：保留本地与服务端双方版本 */
export interface CommitConflict {
  field: keyof TableRow;
  baseValue: CellValue;
  localValue: CellValue;
  remoteValue: CellValue;
}

/**
 * 可追踪的变更提交。
 * 一次提交记录订单号、若干字段变更及各自的本地基准值，
 * 作为幂等与冲突判定的依据。
 */
export interface ChangeCommit {
  id: string;
  orderId: string;
  orderNo: string;
  changes: FieldChange[];
  status: CommitStatus;
  createdAt: string;
  clientId: string;
  syncedAt?: string;
  error?: string;
  conflicts?: CommitConflict[];
}

/** 服务端对一次提交的处理结果 */
export interface CommitSyncResult {
  commitId: string;
  status: 'synced' | 'conflict';
  duplicated?: boolean;
  conflicts?: CommitConflict[];
}

export interface TableState {
  rows: TableRow[];
  total: number;
  groups: GroupSummary[];
  aggregates: AggregateResult;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  sort: SortState | null;
  filter: FilterGroup;
  search: string;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
  expandedIds: string[];
  selectedIds: string[];
  visibleColumns: Array<keyof TableRow>;
  columnWidths: Record<string, number>;
  pinnedColumns: Array<keyof TableRow>;
  density: 'compact' | 'standard' | 'comfortable';
  elapsedMs: number;
  savedViews: SavedView[];
  activeViewId: string | null;
  /** 可追踪变更提交（本地副本） */
  commits: ChangeCommit[];
  online: boolean;
  syncing: boolean;
  /** 最近一次数据变更时间，用于视图过期判定 */
  lastDataChangeAt: string | null;
}
