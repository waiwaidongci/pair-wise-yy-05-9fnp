import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TABLE_COLUMNS } from './table.reducer';
import { CellValue, TableState } from '../types/table.models';

export const selectTableState = createFeatureSelector<TableState>('table');

export const selectVisibleColumnDefinitions = createSelector(selectTableState, (state) =>
  TABLE_COLUMNS.filter((column) => state.visibleColumns.includes(column.key)).map((column) => ({
    ...column,
    width: state.columnWidths[column.key] ?? 132,
    pinned: state.pinnedColumns.includes(column.key),
  })),
);

export const selectAllColumnDefinitions = createSelector(
  selectTableState,
  (state) => TABLE_COLUMNS.map((column) => ({
    ...column,
    visible: state.visibleColumns.includes(column.key),
    pinned: state.pinnedColumns.includes(column.key),
  })),
);

export const selectPageCount = createSelector(
  selectTableState,
  (state) => Math.max(1, Math.ceil(state.total / state.pageSize)),
);

export const selectSelectionMode = createSelector(
  selectTableState,
  (state) => ({
    allVisibleSelected:
      state.rows.length > 0 && state.rows.every((row) => state.selectedIds.includes(row.id)),
    count: state.selectedIds.length,
  }),
);

/** 可追踪变更提交（本地副本） */
export const selectCommits = createSelector(selectTableState, (state) => state.commits);

/** 待同步 / 同步中 / 失败的提交（需要补交或重试） */
export const selectPendingCommits = createSelector(selectTableState, (state) =>
  state.commits.filter((commit) =>
    ['pending', 'syncing', 'failed'].includes(commit.status),
  ),
);

/** 同字段冲突、保留双方版本的提交 */
export const selectConflictCommits = createSelector(selectTableState, (state) =>
  state.commits.filter((commit) => commit.status === 'conflict'),
);

export const selectFailedCommits = createSelector(selectTableState, (state) =>
  state.commits.filter((commit) => commit.status === 'failed'),
);

export const selectOnline = createSelector(selectTableState, (state) => state.online);

export const selectSyncing = createSelector(selectTableState, (state) => state.syncing);

/** 由未入库提交派生的脏单元格（用于列表标记） */
export const selectDirtyCells = createSelector(selectTableState, (state) => {
  const dirty: Record<string, CellValue> = {};
  for (const commit of state.commits) {
    if (commit.status === 'synced') {
      continue;
    }
    for (const change of commit.changes) {
      dirty[`${commit.orderId}::${String(change.field)}`] = change.newValue;
    }
  }
  return dirty;
});

/**
 * 重算后的订单总额 / 数量 / 毛利率。
 * 服务端聚合为基准，再叠加尚未入库提交的本地差额；
 * 已入库的提交已包含在服务端聚合中，不再重复计入。
 */
export const selectDisplayAggregates = createSelector(selectTableState, (state) => {
  const base = state.aggregates;
  let amountDelta = 0;
  let quantityDelta = 0;
  let marginDelta = 0;
  for (const commit of state.commits) {
    if (commit.status === 'synced') {
      continue;
    }
    for (const change of commit.changes) {
      const baseValue = Number(change.baseValue);
      const newValue = Number(change.newValue);
      if (change.field === 'amount') {
        amountDelta += newValue - baseValue;
      } else if (change.field === 'quantity') {
        quantityDelta += newValue - baseValue;
      } else if (change.field === 'margin') {
        marginDelta += (newValue - baseValue) / Math.max(1, state.total);
      }
    }
  }
  return {
    amount: Math.round((base.amount + amountDelta) * 100) / 100,
    quantity: base.quantity + quantityDelta,
    averageMargin: Math.round((base.averageMargin + marginDelta) * 10) / 10,
  };
});
