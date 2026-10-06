import { createReducer, on } from '@ngrx/store';
import {
  AggregateResult,
  CellValue,
  FieldConflict,
  FilterGroup,
  OrderChange,
  SavedView,
  TableRow,
  TableState,
} from '../types/table.models';
import * as TableActions from './table.actions';

const EMPTY_AGGREGATE: AggregateResult = { amount: 0, quantity: 0, averageMargin: 0 };

export const EMPTY_FILTER: FilterGroup = {
  kind: 'group',
  id: 'root',
  logic: 'and',
  children: [],
};

export const TABLE_COLUMNS: Array<{ key: keyof TableRow; label: string }> = [
  { key: 'orderNo', label: '订单编号' },
  { key: 'customer', label: '客户名称' },
  { key: 'region', label: '区域' },
  { key: 'category', label: '产品线' },
  { key: 'owner', label: '负责人' },
  { key: 'amount', label: '合同金额' },
  { key: 'quantity', label: '数量' },
  { key: 'margin', label: '毛利率' },
  { key: 'status', label: '状态' },
  { key: 'updatedAt', label: '更新时间' },
];

const initialVisibleColumns = TABLE_COLUMNS.map((column) => column.key);
const initialWidths = Object.fromEntries(
  TABLE_COLUMNS.map((column) => [
    column.key,
    ['orderNo', 'customer'].includes(String(column.key)) ? 190 : 132,
  ]),
);

const initialViews = readViews();
const persistedSync = readSyncState();

export const initialState: TableState = {
  rows: [],
  total: 0,
  groups: [],
  aggregates: EMPTY_AGGREGATE,
  loading: false,
  error: null,
  page: 0,
  pageSize: 100,
  sort: { field: 'updatedAt', direction: 'desc' },
  filter: EMPTY_FILTER,
  search: '',
  groupBy: null,
  treeMode: false,
  expandedIds: [],
  selectedIds: [],
  visibleColumns: initialVisibleColumns,
  columnWidths: initialWidths,
  pinnedColumns: ['orderNo', 'customer'],
  density: 'standard',
  elapsedMs: 0,
  savedViews: initialViews,
  activeViewId: null,
  dirtyCells: deriveDirtyCells(persistedSync.changes),
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  changes: persistedSync.changes,
  conflicts: persistedSync.conflicts,
  dataVersion: 0,
};

export const tableReducer = createReducer(
  initialState,
  on(TableActions.loadPage, (state) => ({ ...state, loading: true, error: null })),
  on(TableActions.loadPageSuccess, (state, { result }) => ({
    ...state,
    rows: result.rows.map((row) => {
      const dirty = Object.entries(state.dirtyCells).reduce<TableRow>((current, [key, value]) => {
        const [id, field] = key.split('::');
        return current.id === id ? { ...current, [field]: value } : current;
      }, row);
      return dirty;
    }),
    total: result.total,
    groups: result.groups,
    aggregates: result.aggregates,
    loading: false,
    elapsedMs: result.elapsedMs,
  })),
  on(TableActions.loadPageFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(TableActions.setPage, (state, { page }) => ({ ...state, page })),
  on(TableActions.setPageSize, (state, { pageSize }) => ({ ...state, pageSize, page: 0 })),
  on(TableActions.setSort, (state, { sort }) => ({ ...state, sort, page: 0 })),
  on(TableActions.setFilter, (state, { filter }) => ({ ...state, filter, page: 0 })),
  on(TableActions.setSearch, (state, { search }) => ({ ...state, search, page: 0 })),
  on(TableActions.setGroupBy, (state, { groupBy }) => ({ ...state, groupBy, page: 0 })),
  on(TableActions.toggleTreeMode, (state) => ({ ...state, treeMode: !state.treeMode, page: 0 })),
  on(TableActions.toggleExpanded, (state, { id }) => ({
    ...state,
    expandedIds: state.expandedIds.includes(id)
      ? state.expandedIds.filter((item) => item !== id)
      : [...state.expandedIds, id],
  })),
  on(TableActions.setSelection, (state, { ids }) => ({ ...state, selectedIds: ids })),
  on(TableActions.toggleColumn, (state, { key }) => ({
    ...state,
    visibleColumns: state.visibleColumns.includes(key)
      ? state.visibleColumns.filter((item) => item !== key)
      : [...state.visibleColumns, key],
  })),
  on(TableActions.resizeColumn, (state, { key, width }) => ({
    ...state,
    columnWidths: { ...state.columnWidths, [key]: Math.max(88, width) },
  })),
  on(TableActions.togglePinned, (state, { key }) => ({
    ...state,
    pinnedColumns: state.pinnedColumns.includes(key)
      ? state.pinnedColumns.filter((item) => item !== key)
      : [...state.pinnedColumns, key],
  })),
  on(TableActions.setDensity, (state, { density }) => ({ ...state, density })),
  on(TableActions.updateCell, (state, { id, key, value }) => {
    const row = state.rows.find((item) => item.id === id);
    const existing = state.changes.find(
      (change) => change.orderId === id && change.field === key && change.status !== 'synced',
    );
    // 本地基准：该字段最后一次与服务端一致的值；已有未入库变更时沿用它，
    // 在途（syncing）变更则以在途值作为新基准，与其结果衔接
    const baseValue = existing
      ? existing.status === 'syncing'
        ? existing.value
        : existing.baseValue
      : row?.[key] ?? null;
    const rows = state.rows.map((item) => (item.id === id ? { ...item, [key]: value } : item));

    let changes: OrderChange[];
    if (value === baseValue) {
      // 改回基准值，撤销这条变更
      changes = state.changes.filter((change) => change !== existing);
    } else if (existing) {
      // 冲突中的变更被再次编辑：以远端值作为新基准重新提交；
      // 在途变更被再次编辑：以在途值作为新基准与其结果衔接
      const conflict = state.conflicts.find((item) => item.localCommitId === existing.commitId);
      const nextBase = conflict ? conflict.remoteValue : baseValue;
      changes = state.changes.map((change) =>
        change === existing
          ? { ...change, value, baseValue: nextBase, status: 'pending' as const, lastError: null }
          : change,
      );
    } else {
      changes = [
        ...state.changes,
        {
          commitId: `commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          orderId: id,
          orderNo: row?.orderNo ?? id,
          field: key,
          baseValue,
          value,
          author: '万宁',
          createdAt: new Date().toISOString(),
          status: 'pending' as const,
          attempts: 0,
          lastError: null,
        },
      ];
    }
    // 只保留仍处于冲突状态的冲突记录
    const conflicts = state.conflicts.filter((conflict) => {
      const change = changes.find((item) => item.commitId === conflict.localCommitId);
      return change?.status === 'conflict';
    });
    const dirtyCells = deriveDirtyCells(changes);
    persistSyncState(changes, conflicts);
    return { ...state, rows, changes, conflicts, dirtyCells };
  }),
  on(TableActions.setOnline, (state, { online }) => ({ ...state, online })),
  on(TableActions.syncStarted, (state, { commitIds }) => {
    const changes: OrderChange[] = state.changes.map((change) =>
      commitIds.includes(change.commitId) && change.status !== 'synced'
        ? {
            ...change,
            status: 'syncing' as const,
            attempts: change.status === 'syncing' ? change.attempts : change.attempts + 1,
          }
        : change,
    );
    persistSyncState(changes, state.conflicts);
    return { ...state, changes };
  }),
  on(TableActions.syncSucceeded, (state, { results }) => {
    const conflicts = [...state.conflicts];
    let applied = 0;
    const changes: OrderChange[] = state.changes.map((change) => {
      const result = results.find((item) => item.commitId === change.commitId);
      // 只处理仍处于在途状态的变更；同步期间被再次编辑的变更保持待同步，
      // 其基准已在编辑时与在途值衔接，等待下一轮提交
      if (!result || change.status !== 'syncing') {
        return change;
      }
      if (result.outcome === 'conflict') {
        // 同字段冲突：本地版本与远端版本都保留，等待人工选择
        const conflict: FieldConflict = {
          id: `${change.orderId}::${String(change.field)}`,
          orderId: change.orderId,
          orderNo: change.orderNo,
          field: change.field,
          baseValue: change.baseValue,
          localValue: change.value,
          localCommitId: change.commitId,
          remoteValue: result.serverValue ?? null,
          remoteAuthor: result.serverAuthor ?? '另一运营',
          detectedAt: new Date().toISOString(),
        };
        const index = conflicts.findIndex((item) => item.id === conflict.id);
        if (index >= 0) {
          conflicts[index] = conflict;
        } else {
          conflicts.push(conflict);
        }
        return { ...change, status: 'conflict' as const };
      }
      applied += result.outcome === 'applied' ? 1 : 0;
      return { ...change, status: 'synced' as const, lastError: null };
    });
    // 已入库的保留最近 20 条用于追踪
    const synced = changes.filter((change) => change.status === 'synced');
    const trimmed =
      synced.length > 20
        ? [...changes.filter((change) => change.status !== 'synced'), ...synced.slice(-20)]
        : changes;
    const dirtyCells = deriveDirtyCells(trimmed);
    persistSyncState(trimmed, conflicts);
    return {
      ...state,
      changes: trimmed,
      conflicts,
      dirtyCells,
      dataVersion: state.dataVersion + applied,
    };
  }),
  on(TableActions.syncFailed, (state, { commitIds, error }) => {
    // 失败不丢数据：变更副本保留在本地，标记失败后可重试
    const changes: OrderChange[] = state.changes.map((change) =>
      commitIds.includes(change.commitId) && change.status === 'syncing'
        ? { ...change, status: 'failed' as const, lastError: error }
        : change,
    );
    persistSyncState(changes, state.conflicts);
    return { ...state, changes };
  }),
  on(TableActions.retryFailedChanges, (state) => {
    const changes: OrderChange[] = state.changes.map((change) =>
      change.status === 'failed' ? { ...change, status: 'pending' as const, lastError: null } : change,
    );
    persistSyncState(changes, state.conflicts);
    return { ...state, changes };
  }),
  on(TableActions.discardChange, (state, { commitId }) => {
    const target = state.changes.find((change) => change.commitId === commitId);
    const changes = state.changes.filter((change) => change.commitId !== commitId);
    const conflicts = state.conflicts.filter((conflict) => conflict.localCommitId !== commitId);
    const rows = target
      ? state.rows.map((row) =>
          row.id === target.orderId ? { ...row, [target.field]: target.baseValue } : row,
        )
      : state.rows;
    const dirtyCells = deriveDirtyCells(changes);
    persistSyncState(changes, conflicts);
    return { ...state, changes, conflicts, rows, dirtyCells };
  }),
  on(TableActions.resolveConflict, (state, { id, keep }) => {
    const conflict = state.conflicts.find((item) => item.id === id);
    if (!conflict) {
      return state;
    }
    const conflicts = state.conflicts.filter((item) => item.id !== id);
    let changes: OrderChange[];
    let rows = state.rows;
    if (keep === 'local') {
      // 保留本地：以远端值作为新基准重新提交本地版本
      changes = state.changes.map((change) =>
        change.commitId === conflict.localCommitId
          ? {
              ...change,
              baseValue: conflict.remoteValue,
              value: conflict.localValue,
              status: 'pending' as const,
              lastError: null,
            }
          : change,
      );
    } else {
      // 采用远端：放弃本地版本，回显服务端值
      changes = state.changes.filter((change) => change.commitId !== conflict.localCommitId);
      rows = state.rows.map((row) =>
        row.id === conflict.orderId ? { ...row, [conflict.field]: conflict.remoteValue } : row,
      );
    }
    const dirtyCells = deriveDirtyCells(changes);
    persistSyncState(changes, conflicts);
    return { ...state, changes, conflicts, rows, dirtyCells };
  }),
  on(TableActions.saveView, (state, { name }) => {
    const view: SavedView = {
      id: `view-${Date.now()}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      dataVersion: state.dataVersion,
      pageSize: state.pageSize,
      visibleColumns: [...state.visibleColumns],
      columnWidths: { ...state.columnWidths },
      pinnedColumns: [...state.pinnedColumns],
      sort: state.sort,
      filter: state.filter,
      groupBy: state.groupBy,
      treeMode: state.treeMode,
    };
    const savedViews = [...state.savedViews.filter((item) => item.name !== view.name), view];
    persistViews(savedViews);
    return { ...state, savedViews, activeViewId: view.id };
  }),
  on(TableActions.applyView, (state, { view }) => ({
    ...state,
    pageSize: view.pageSize,
    visibleColumns: [...view.visibleColumns],
    columnWidths: { ...view.columnWidths },
    pinnedColumns: [...view.pinnedColumns],
    sort: view.sort,
    filter: view.filter,
    groupBy: view.groupBy,
    treeMode: view.treeMode,
    activeViewId: view.id,
    page: 0,
  })),
  on(TableActions.deleteView, (state, { id }) => {
    const savedViews = state.savedViews.filter((view) => view.id !== id);
    persistViews(savedViews);
    return {
      ...state,
      savedViews,
      activeViewId: state.activeViewId === id ? null : state.activeViewId,
    };
  }),
);

function readViews(): SavedView[] {
  try {
    const raw = localStorage.getItem('pair-wise-yy-05:views');
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

function persistViews(views: SavedView[]): void {
  localStorage.setItem('pair-wise-yy-05:views', JSON.stringify(views));
}

const SYNC_STORAGE_KEY = 'pair-wise-yy-05:changes';

/** 断网/失败时的本地副本：刷新页面后仍能恢复并补交 */
function readSyncState(): { changes: OrderChange[]; conflicts: FieldConflict[] } {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) {
      return { changes: [], conflicts: [] };
    }
    const parsed = JSON.parse(raw) as { changes?: OrderChange[]; conflicts?: FieldConflict[] };
    // 上次会话中断在同步中的变更，恢复为待同步重新排队
    const changes = (parsed.changes ?? []).map((change) =>
      change.status === 'syncing' ? { ...change, status: 'pending' as const } : change,
    );
    return { changes, conflicts: parsed.conflicts ?? [] };
  } catch {
    return { changes: [], conflicts: [] };
  }
}

function persistSyncState(changes: OrderChange[], conflicts: FieldConflict[]): void {
  localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ changes, conflicts }));
}

/** 未入库变更的本地值，用于回显在列表上（已入库的由服务端数据承载） */
function deriveDirtyCells(changes: OrderChange[]): Record<string, CellValue> {
  const dirty: Record<string, CellValue> = {};
  changes.forEach((change) => {
    if (change.status !== 'synced') {
      dirty[`${change.orderId}::${String(change.field)}`] = change.value;
    }
  });
  return dirty;
}
