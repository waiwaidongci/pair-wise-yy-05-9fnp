import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import { DataGridComponent, GridColumn } from './components/data-grid/data-grid.component';
import { FilterBuilderComponent } from './components/filter-builder/filter-builder.component';
import { MockTableApiService } from './data/mock-table-api.service';
import * as TableActions from './stores/table.actions';
import {
  selectAllColumnDefinitions,
  selectPageCount,
  selectTableState,
  selectVisibleColumnDefinitions,
} from './stores/table.selectors';
import { ChangeStatus, FilterGroup, SavedView, SortState, TableRow } from './types/table.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DataGridComponent,
    FilterBuilderComponent,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSidenavModule,
    MatSnackBarModule,
    MatToolbarModule,
    MatTooltipModule,
  ],
  template: `
    @let state = tableState();
    <mat-toolbar class="app-toolbar">
      <div class="brand">
        <span class="brand__mark"><mat-icon>dataset</mat-icon></span>
        <span>
          <strong>企业订单数据中心</strong>
          <small>Order Operations Console</small>
        </span>
      </div>
      <span class="environment">生产环境</span>
      <span class="spacer"></span>
      <span class="dataset-count">模拟数据集 50,000 行</span>
      <button mat-icon-button matTooltip="通知"><mat-icon>notifications_none</mat-icon></button>
      <button mat-button>
        <span class="avatar">万</span>
        万宁
        <mat-icon>expand_more</mat-icon>
      </button>
    </mat-toolbar>

    <mat-sidenav-container class="workspace" [hasBackdrop]="false">
      <mat-sidenav mode="side" opened class="side-panel">
        <div class="side-panel__section">
          <p class="side-panel__eyebrow">我的视图</p>
          <button
            class="view-link"
            type="button"
            [class.view-link--active]="!state.activeViewId"
            (click)="resetView()"
          >
            <mat-icon>table_view</mat-icon>
            全部订单
            <span>{{ state.total | number }}</span>
          </button>
          @for (view of state.savedViews; track view.id) {
            <button
              class="view-link"
              type="button"
              [class.view-link--active]="state.activeViewId === view.id"
              (click)="applyView(view)"
            >
              <mat-icon>bookmark</mat-icon>
              {{ view.name }}
              <span class="view-link__delete" (click)="deleteView($event, view.id)">×</span>
            </button>
          }
        </div>

        <mat-divider />

        <div class="side-panel__section">
          <p class="side-panel__eyebrow">数据概况</p>
          <div class="metric">
            <span>筛选后订单</span>
            <strong>{{ state.total | number }}</strong>
          </div>
          <div class="metric">
            <span>订单总额</span>
            <strong>¥{{ compactAmount() }}</strong>
          </div>
          <div class="metric">
            <span>平均毛利率</span>
            <strong>{{ state.aggregates.averageMargin }}%</strong>
          </div>
          <div class="metric">
            <span>当前选择</span>
            <strong>{{ state.selectedIds.length }} 行</strong>
          </div>
        </div>

        <mat-divider />

        <div class="side-panel__section tips">
          <p class="side-panel__eyebrow">键盘操作</p>
          <p><kbd>↑</kbd><kbd>↓</kbd> 移动单元格</p>
          <p><kbd>Enter</kbd> 编辑当前行</p>
          <p><kbd>Space</kbd> 选择当前行</p>
          <p><kbd>Ctrl</kbd> + <kbd>A</kbd> 全选本页</p>
        </div>
      </mat-sidenav>

      <mat-sidenav-content class="content">
        <section class="page-heading">
          <div>
            <span class="breadcrumb">订单中心 / 销售订单</span>
            <h1>销售订单明细</h1>
            <p>服务端分页查询、复杂表达式筛选、聚合分析与可复用列视图。</p>
          </div>
          <div class="page-actions">
            <button mat-stroked-button type="button" (click)="refresh()">
              <mat-icon>refresh</mat-icon>
              刷新
            </button>
            <button mat-flat-button color="primary" type="button" (click)="exportCsv()">
              <mat-icon>download</mat-icon>
              导出本页
            </button>
          </div>
        </section>

        <section class="toolbar-panel">
          <div class="toolbar-row">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search-field">
              <mat-icon matPrefix>search</mat-icon>
              <input
                matInput
                placeholder="搜索订单号、客户、负责人"
                [ngModel]="state.search"
                (ngModelChange)="setSearch($event)"
              >
            </mat-form-field>
            <button mat-stroked-button type="button" (click)="toggleFilterPanel()">
              <mat-icon>filter_alt</mat-icon>
              高级筛选
              @if (conditionCount()) {
                <span class="count-badge">{{ conditionCount() }}</span>
              }
            </button>
            <button mat-stroked-button type="button" [matMenuTriggerFor]="groupMenu">
              <mat-icon>stacked_bar_chart</mat-icon>
              {{ state.groupBy ? '分组：' + groupLabel(state.groupBy) : '添加分组' }}
            </button>
            <mat-menu #groupMenu="matMenu">
              <button mat-menu-item (click)="setGroup(null)">不分组</button>
              @for (column of allColumns(); track column.key) {
                <button mat-menu-item (click)="setGroup(column.key)">{{ column.label }}</button>
              }
            </mat-menu>
            <button
              mat-stroked-button
              type="button"
              [color]="state.treeMode ? 'primary' : undefined"
              (click)="toggleTree()"
            >
              <mat-icon>account_tree</mat-icon>
              {{ state.treeMode ? '树形模式' : '普通模式' }}
            </button>
            <span class="spacer"></span>
            <button mat-stroked-button type="button" [matMenuTriggerFor]="columnMenu">
              <mat-icon>view_column</mat-icon>
              列配置
            </button>
            <mat-menu #columnMenu="matMenu" class="column-menu">
              <div class="menu-title">显示列与固定列</div>
              @for (column of allColumns(); track column.key) {
                <button mat-menu-item type="button" (click)="toggleColumn(column.key)">
                  <mat-icon>{{ column.visible ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
                  <span>{{ column.label }}</span>
                  <span
                    class="pin-action"
                    [class.pin-action--active]="column.pinned"
                    (click)="togglePin($event, column.key)"
                  >
                    <mat-icon>push_pin</mat-icon>
                  </span>
                </button>
              }
              <mat-divider />
              <button mat-menu-item type="button" (click)="saveView()">
                <mat-icon>bookmark_add</mat-icon>
                保存当前视图
              </button>
            </mat-menu>
            <button mat-stroked-button type="button" [matMenuTriggerFor]="densityMenu">
              <mat-icon>density_medium</mat-icon>
              行高
            </button>
            <mat-menu #densityMenu="matMenu">
              <button mat-menu-item (click)="setDensity('compact')">紧凑</button>
              <button mat-menu-item (click)="setDensity('standard')">标准</button>
              <button mat-menu-item (click)="setDensity('comfortable')">宽松</button>
            </mat-menu>
            <button mat-stroked-button type="button" (click)="toggleOnline()">
              <mat-icon>{{ state.online ? 'cloud_done' : 'cloud_off' }}</mat-icon>
              {{ state.online ? '在线' : '模拟断网中' }}
            </button>
            <button mat-stroked-button type="button" (click)="toggleChangeCenter()">
              <mat-icon>published_with_changes</mat-icon>
              变更中心
              @if (pendingCount()) {
                <span class="count-badge">{{ pendingCount() }}</span>
              }
            </button>
          </div>

          @if (showFilterPanel()) {
            <div class="filter-panel">
              <app-filter-builder
                [group]="state.filter"
                (change)="setFilter($event)"
                (remove)="removeFilterNode($event)"
              />
              <div class="filter-actions">
                <span>可嵌套“且 / 或”条件组，表达式由模拟服务端执行。</span>
                <button mat-button type="button" (click)="clearFilter()">清空条件</button>
              </div>
            </div>
          }
        </section>

        @if (showChangeCenter()) {
          <section class="change-panel">
            <div class="change-panel__head">
              <strong>订单变更提交</strong>
              <span class="muted">按订单号合并补交 · 重复提交自动去重 · 断网暂存本地副本</span>
              <span class="spacer"></span>
              <button mat-button type="button" [disabled]="!failedCount()" (click)="retryFailed()">
                重试失败 ({{ failedCount() }})
              </button>
              <button mat-button type="button" [disabled]="!activeChanges().length" (click)="simulateExternal()">
                模拟另一运营改同字段
              </button>
            </div>

            @if (conflicts().length) {
              <div class="change-group">
                <p class="change-group__title change-group__title--conflict">
                  字段冲突（双方版本已保留，请选择）
                </p>
                @for (conflict of conflicts(); track conflict.id) {
                  <div class="change-item">
                    <span class="change-item__order">{{ conflict.orderNo }}</span>
                    <span class="change-item__field">{{ fieldLabel(conflict.field) }}</span>
                    <span>本地：<strong>{{ conflict.localValue }}</strong></span>
                    <span>远端（{{ conflict.remoteAuthor }}）：<strong>{{ conflict.remoteValue }}</strong></span>
                    <span class="spacer"></span>
                    <button mat-stroked-button type="button" (click)="resolveConflict(conflict.id, 'local')">
                      保留本地
                    </button>
                    <button mat-stroked-button type="button" (click)="resolveConflict(conflict.id, 'remote')">
                      采用远端
                    </button>
                  </div>
                }
              </div>
            }

            @if (activeChanges().length) {
              <div class="change-group">
                <p class="change-group__title">待同步变更</p>
                @for (change of activeChanges(); track change.commitId) {
                  <div class="change-item">
                    <span class="change-item__order">{{ change.orderNo }}</span>
                    <span class="change-item__field">{{ fieldLabel(change.field) }}</span>
                    <span class="change-item__delta">{{ change.baseValue }} → <strong>{{ change.value }}</strong></span>
                    <span class="change-status" [ngClass]="'change-status--' + change.status">
                      {{ statusLabel(change.status) }}
                    </span>
                    @if (change.lastError) {
                      <span class="change-item__error">{{ change.lastError }}</span>
                    }
                    <span class="spacer"></span>
                    <button
                      mat-icon-button
                      type="button"
                      matTooltip="撤销该变更"
                      (click)="discardChange(change.commitId)"
                    >
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                }
              </div>
            }

            @if (syncedChanges().length) {
              <div class="change-group">
                <p class="change-group__title">已入库（最近 {{ syncedChanges().length }} 条）</p>
                @for (change of syncedChanges(); track change.commitId) {
                  <div class="change-item change-item--synced">
                    <mat-icon>check_circle</mat-icon>
                    <span class="change-item__order">{{ change.orderNo }}</span>
                    <span class="change-item__field">{{ fieldLabel(change.field) }}</span>
                    <span class="change-item__delta">{{ change.baseValue }} → {{ change.value }}</span>
                    <span class="muted">{{ change.createdAt | date:'HH:mm:ss' }}</span>
                  </div>
                }
              </div>
            }

            @if (!activeChanges().length && !conflicts().length && !syncedChanges().length) {
              <p class="change-empty">暂无变更，双击表格单元格即可编辑并生成可追踪提交。</p>
            }
          </section>
        }

        @if (state.groups.length) {
          <section class="group-strip">
            @for (group of state.groups.slice(0, 6); track group.key) {
              <button type="button" class="group-card" (click)="filterGroup(group.key)">
                <span>{{ group.key }}</span>
                <strong>{{ group.count | number }} 单</strong>
                <small>¥{{ group.aggregate.amount / 10000 | number:'1.1-1' }} 万</small>
              </button>
            }
          </section>
        }

        <section class="table-panel">
          <div class="table-statusbar">
            <span class="live-dot"></span>
            <strong>{{ state.total | number }}</strong> 条结果
            <span class="muted">· 第 {{ state.page + 1 }} / {{ pageCount() }} 页</span>
            <span class="muted">· 查询 {{ state.elapsedMs }}ms</span>
            @if (state.selectedIds.length) {
              <span class="selection-note">已选择 {{ state.selectedIds.length }} 行</span>
            }
            @if (!state.online) {
              <span class="offline-note">已断网 · 变更暂存本地，回网后自动补交</span>
            } @else if (pendingCount()) {
              <span class="selection-note">{{ pendingCount() }} 条变更待同步</span>
            }
            <span class="spacer"></span>
            <span class="muted">双击单元格可内联编辑</span>
          </div>
          @if (state.loading) {
            <mat-progress-bar mode="indeterminate" />
          }
          <app-data-grid
            [rows]="state.rows"
            [columns]="visibleColumns()"
            [loading]="state.loading"
            [density]="state.density"
            [sort]="state.sort"
            [selectedIds]="state.selectedIds"
            [dirtyCells]="state.dirtyCells"
            [expandedIds]="state.expandedIds"
            [treeMode]="state.treeMode"
            (sortChange)="changeSort($event)"
            (resize)="resizeColumn($event.key, $event.width)"
            (selectionChange)="setSelection($event)"
            (edit)="updateCell($event)"
            (expand)="toggleExpand($event)"
            (inspect)="showRow($event)"
          />
          <mat-paginator
            [length]="state.total"
            [pageIndex]="state.page"
            [pageSize]="state.pageSize"
            [pageSizeOptions]="[50, 100, 200, 500]"
            [showFirstLastButtons]="true"
            (page)="changePage($event)"
          />
        </section>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
    }
    .app-toolbar {
      position: sticky;
      z-index: 20;
      top: 0;
      height: 60px;
      padding: 0 20px;
      border-bottom: 1px solid #d8e0eb;
      background: rgba(255,255,255,.97);
      color: #172033;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 11px;
    }
    .brand__mark {
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      border-radius: 9px;
      background: #175cd3;
      color: #fff;
    }
    .brand__mark mat-icon {
      font-size: 22px;
    }
    .brand strong,
    .brand small {
      display: block;
    }
    .brand strong {
      font-size: 15px;
    }
    .brand small {
      margin-top: 1px;
      color: #667085;
      font-size: 10px;
      letter-spacing: .05em;
    }
    .environment {
      margin-left: 16px;
      padding: 3px 8px;
      border-radius: 5px;
      background: #ecfdf3;
      color: #027a48;
      font-size: 11px;
    }
    .dataset-count {
      margin-right: 14px;
      color: #667085;
      font-size: 12px;
    }
    .avatar {
      display: grid;
      width: 28px;
      height: 28px;
      margin-right: 8px;
      place-items: center;
      border-radius: 50%;
      background: #eef4ff;
      color: #175cd3;
    }
    .workspace {
      height: calc(100vh - 60px);
      background: #eef2f7;
    }
    .side-panel {
      width: 224px;
      border: 0;
      border-right: 1px solid #d8e0eb;
      background: #fbfcfe;
    }
    .side-panel__section {
      padding: 18px 14px;
    }
    .side-panel__eyebrow {
      margin: 0 0 10px;
      color: #98a2b3;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .view-link {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 8px;
      padding: 9px 10px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #475467;
      cursor: pointer;
      text-align: left;
    }
    .view-link:hover,
    .view-link--active {
      background: #eef4ff;
      color: #175cd3;
    }
    .view-link mat-icon {
      font-size: 18px;
    }
    .view-link span {
      margin-left: auto;
      font-size: 11px;
    }
    .view-link__delete {
      padding: 0 4px;
      color: #98a2b3;
    }
    .metric {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 7px 0;
      color: #667085;
      font-size: 12px;
    }
    .metric strong {
      color: #172033;
      font-size: 14px;
    }
    .tips p {
      margin: 8px 0;
      color: #667085;
      font-size: 12px;
    }
    kbd {
      display: inline-block;
      min-width: 22px;
      margin-right: 3px;
      padding: 1px 5px;
      border: 1px solid #cfd6e2;
      border-bottom-width: 2px;
      border-radius: 4px;
      background: #fff;
      color: #344054;
      font-size: 10px;
      text-align: center;
    }
    .content {
      padding: 22px;
    }
    .page-heading {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }
    .breadcrumb {
      color: #667085;
      font-size: 12px;
    }
    h1 {
      margin: 5px 0 4px;
      font-size: 25px;
      letter-spacing: -.02em;
    }
    .page-heading p {
      margin: 0;
      color: #667085;
      font-size: 13px;
    }
    .page-actions {
      display: flex;
      gap: 8px;
    }
    .toolbar-panel {
      padding: 14px;
      border: 1px solid #dce3ec;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(16,24,40,.03);
    }
    .toolbar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .search-field {
      width: 300px;
    }
    .search-field mat-icon {
      margin-right: 4px;
    }
    .count-badge {
      display: inline-grid;
      min-width: 18px;
      height: 18px;
      margin-left: 5px;
      place-items: center;
      border-radius: 9px;
      background: #175cd3;
      color: #fff;
      font-size: 10px;
    }
    .menu-title {
      padding: 8px 16px 4px;
      color: #667085;
      font-size: 11px;
      font-weight: 700;
    }
    .pin-action {
      display: inline-grid;
      width: 30px;
      height: 30px;
      margin-left: auto;
      place-items: center;
      border-radius: 5px;
      color: #98a2b3;
    }
    .pin-action--active {
      background: #eef4ff;
      color: #175cd3;
    }
    .pin-action mat-icon {
      font-size: 17px;
    }
    .filter-panel {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #eaecf0;
    }
    .filter-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
      color: #667085;
      font-size: 12px;
    }
    .group-strip {
      display: grid;
      grid-template-columns: repeat(6, minmax(130px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .group-card {
      padding: 11px 13px;
      border: 1px solid #dce3ec;
      border-radius: 9px;
      background: #fff;
      cursor: pointer;
      text-align: left;
    }
    .group-card:hover {
      border-color: #84adff;
      box-shadow: 0 3px 10px rgba(23,92,211,.08);
    }
    .group-card span,
    .group-card strong,
    .group-card small {
      display: block;
    }
    .group-card span {
      color: #667085;
      font-size: 11px;
    }
    .group-card strong {
      margin: 4px 0;
      color: #172033;
      font-size: 16px;
    }
    .group-card small {
      color: #175cd3;
    }
    .table-panel {
      display: flex;
      height: calc(100vh - 292px);
      min-height: 480px;
      flex-direction: column;
      margin-top: 12px;
      overflow: hidden;
      border: 1px solid #dce3ec;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 2px 5px rgba(16,24,40,.04);
    }
    .table-statusbar {
      display: flex;
      min-height: 38px;
      align-items: center;
      gap: 5px;
      padding: 0 13px;
      border-bottom: 1px solid #eaecf0;
      color: #344054;
      font-size: 12px;
    }
    .live-dot {
      width: 7px;
      height: 7px;
      margin-right: 4px;
      border-radius: 50%;
      background: #12b76a;
      box-shadow: 0 0 0 3px #d1fadf;
    }
    .selection-note {
      margin-left: 12px;
      color: #175cd3;
    }
    .offline-note {
      margin-left: 12px;
      color: #b42318;
    }
    .change-panel {
      margin-top: 12px;
      padding: 14px;
      border: 1px solid #f6d08a;
      border-radius: 12px;
      background: #fffaeb;
    }
    .change-panel__head {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .change-group {
      margin-top: 10px;
    }
    .change-group__title {
      margin: 0 0 6px;
      color: #667085;
      font-size: 12px;
      font-weight: 700;
    }
    .change-group__title--conflict {
      color: #b42318;
    }
    .change-item {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
      padding: 6px 10px;
      border: 1px solid #eaecf0;
      border-radius: 7px;
      background: #fff;
      font-size: 12px;
    }
    .change-item__order {
      color: #175cd3;
      font-weight: 700;
    }
    .change-item__field {
      color: #475467;
    }
    .change-item__delta {
      color: #344054;
    }
    .change-item__error {
      color: #b42318;
    }
    .change-item--synced {
      color: #667085;
    }
    .change-item--synced mat-icon {
      width: 16px;
      height: 16px;
      color: #12b76a;
      font-size: 16px;
    }
    .change-status {
      padding: 2px 8px;
      border-radius: 9px;
      background: #eef4ff;
      color: #175cd3;
      font-size: 11px;
    }
    .change-status--syncing {
      background: #fffaeb;
      color: #b54708;
    }
    .change-status--failed,
    .change-status--conflict {
      background: #fef3f2;
      color: #b42318;
    }
    .change-empty {
      margin: 8px 0 0;
      color: #98a2b3;
      font-size: 12px;
    }
    app-data-grid {
      min-height: 0;
      flex: 1;
    }
    mat-paginator {
      border-top: 1px solid #eaecf0;
      background: #fbfcfe;
    }
    @media (max-width: 1100px) {
      .side-panel {
        display: none;
      }
      .group-strip {
        grid-template-columns: repeat(3, 1fr);
      }
      .table-panel {
        height: calc(100vh - 270px);
      }
    }
  `],
})
export class AppComponent {
  private readonly store = inject(Store);
  private readonly snackBar = inject(MatSnackBar);
  private readonly actions$ = inject(Actions);
  private readonly api = inject(MockTableApiService);

  readonly tableState = this.store.selectSignal(selectTableState);
  readonly allColumns = this.store.selectSignal(selectAllColumnDefinitions);
  readonly visibleColumns = this.store.selectSignal(selectVisibleColumnDefinitions) as unknown as () => GridColumn[];
  readonly pageCount = this.store.selectSignal(selectPageCount);
  readonly showFilterPanel = signal(false);
  readonly showChangeCenter = signal(false);
  readonly conditionCount = computed(() => this.countConditions(this.tableState().filter));
  readonly activeChanges = computed(() =>
    this.tableState().changes.filter((change) => change.status !== 'synced'),
  );
  readonly syncedChanges = computed(() =>
    this.tableState().changes.filter((change) => change.status === 'synced').slice(-8).reverse(),
  );
  readonly conflicts = computed(() => this.tableState().conflicts);
  readonly pendingCount = computed(() => this.activeChanges().length + this.conflicts().length);
  readonly failedCount = computed(
    () => this.tableState().changes.filter((change) => change.status === 'failed').length,
  );
  readonly compactAmount = computed(() => {
    const amount = this.tableState().aggregates.amount;
    if (amount >= 100000000) return `${(amount / 100000000).toFixed(2)} 亿`;
    if (amount >= 10000) return `${(amount / 10000).toFixed(1)} 万`;
    return amount.toLocaleString('zh-CN');
  });

  constructor() {
    this.store.dispatch(TableActions.loadPage({ refresh: true }));
    window.addEventListener('online', () =>
      this.store.dispatch(TableActions.setOnline({ online: true })),
    );
    window.addEventListener('offline', () =>
      this.store.dispatch(TableActions.setOnline({ online: false })),
    );
    this.actions$.pipe(ofType(TableActions.syncSucceeded)).subscribe(({ results }) => {
      const applied = results.filter((result) => result.outcome === 'applied').length;
      const conflicts = results.filter((result) => result.outcome === 'conflict').length;
      if (applied) {
        this.snackBar.open(`已提交 ${applied} 条订单变更，列表与订单总额已重算`, '关闭', {
          duration: 2200,
        });
      }
      if (conflicts) {
        this.snackBar
          .open(`发现 ${conflicts} 条字段冲突，双方版本已保留`, '去处理', { duration: 4500 })
          .onAction()
          .subscribe(() => this.showChangeCenter.set(true));
      }
    });
    this.actions$.pipe(ofType(TableActions.syncFailed)).subscribe(({ error }) => {
      this.snackBar
        .open(`提交失败：${error}，变更已保留本地副本`, '重试', { duration: 4500 })
        .onAction()
        .subscribe(() => this.store.dispatch(TableActions.retryFailedChanges()));
    });
  }

  refresh(): void {
    this.store.dispatch(TableActions.loadPage({ refresh: true }));
    this.snackBar.open('已刷新模拟服务端数据', '关闭', { duration: 1800 });
  }

  setSearch(search: string): void {
    this.store.dispatch(TableActions.setSearch({ search }));
  }

  toggleFilterPanel(): void {
    this.showFilterPanel.update((value) => !value);
  }

  setFilter(filter: FilterGroup): void {
    this.store.dispatch(TableActions.setFilter({ filter }));
  }

  removeFilterNode(id: string): void {
    this.setFilter(this.removeNode(this.tableState().filter, id));
  }

  clearFilter(): void {
    this.setFilter({ kind: 'group', id: 'root', logic: 'and', children: [] });
  }

  filterGroup(value: string): void {
    this.setFilter({
      kind: 'group',
      id: 'root',
      logic: 'and',
      children: [{
        kind: 'condition',
        id: `condition-${Date.now()}`,
        field: this.tableState().groupBy ?? 'category',
        operator: 'equals',
        value,
      }],
    });
    this.showFilterPanel.set(true);
  }

  setGroup(groupBy: keyof TableRow | null): void {
    this.store.dispatch(TableActions.setGroupBy({ groupBy }));
  }

  groupLabel(key: keyof TableRow): string {
    return this.allColumns().find((column) => column.key === key)?.label ?? String(key);
  }

  toggleTree(): void {
    this.store.dispatch(TableActions.toggleTreeMode());
  }

  toggleColumn(key: keyof TableRow): void {
    this.store.dispatch(TableActions.toggleColumn({ key }));
  }

  togglePin(event: Event, key: keyof TableRow): void {
    event.stopPropagation();
    this.store.dispatch(TableActions.togglePinned({ key }));
  }

  resizeColumn(key: keyof TableRow, width: number): void {
    this.store.dispatch(TableActions.resizeColumn({ key, width }));
  }

  setDensity(density: 'compact' | 'standard' | 'comfortable'): void {
    this.store.dispatch(TableActions.setDensity({ density }));
  }

  changeSort(key: keyof TableRow): void {
    const current = this.tableState().sort;
    const sort: SortState = {
      field: key,
      direction: current?.field === key && current.direction === 'asc' ? 'desc' : 'asc',
    };
    this.store.dispatch(TableActions.setSort({ sort }));
  }

  setSelection(ids: string[]): void {
    this.store.dispatch(TableActions.setSelection({ ids }));
  }

  updateCell(event: { id: string; key: keyof TableRow; value: string | number | boolean | null }): void {
    this.store.dispatch(TableActions.updateCell(event));
    this.snackBar.open('已生成可追踪变更，等待同步入库', '关闭', { duration: 1600 });
  }

  toggleOnline(): void {
    this.store.dispatch(TableActions.setOnline({ online: !this.tableState().online }));
  }

  toggleChangeCenter(): void {
    this.showChangeCenter.update((value) => !value);
  }

  retryFailed(): void {
    this.store.dispatch(TableActions.retryFailedChanges());
  }

  discardChange(commitId: string): void {
    this.store.dispatch(TableActions.discardChange({ commitId }));
  }

  resolveConflict(id: string, keep: 'local' | 'remote'): void {
    this.store.dispatch(TableActions.resolveConflict({ id, keep }));
    this.snackBar.open(keep === 'local' ? '已保留本地版本，将重新提交' : '已采用远端版本', '关闭', {
      duration: 1800,
    });
  }

  /** 演示用：让另一运营在服务端先改了同一字段，触发冲突 */
  simulateExternal(): void {
    const target = this.activeChanges()[0];
    if (!target) {
      return;
    }
    this.api.simulateExternalEdit(target.orderId, target.field);
    this.store.dispatch(TableActions.flushChanges());
    this.snackBar.open(`已模拟另一运营修改 ${target.orderNo} 的同一字段`, '关闭', { duration: 2000 });
  }

  fieldLabel(key: keyof TableRow): string {
    return this.allColumns().find((column) => column.key === key)?.label ?? String(key);
  }

  statusLabel(status: ChangeStatus): string {
    return {
      pending: '待同步',
      syncing: '同步中',
      synced: '已入库',
      failed: '失败',
      conflict: '冲突',
    }[status];
  }

  toggleExpand(id: string): void {
    this.store.dispatch(TableActions.toggleExpanded({ id }));
  }

  showRow(row: TableRow): void {
    this.snackBar.open(`订单 ${row.orderNo}：${row.customer}，${row.status}`, '查看', { duration: 3000 });
  }

  changePage(event: PageEvent): void {
    this.store.dispatch(TableActions.setPageSize({ pageSize: event.pageSize }));
    this.store.dispatch(TableActions.setPage({ page: event.pageIndex }));
  }

  saveView(): void {
    const name = window.prompt('请输入视图名称', `视图 ${this.tableState().savedViews.length + 1}`);
    if (name?.trim()) {
      this.store.dispatch(TableActions.saveView({ name }));
      this.snackBar.open('当前列配置和筛选条件已保存', '关闭', { duration: 1800 });
    }
  }

  applyView(view: SavedView): void {
    // 旧视图过期：保存视图后订单数据已有变更，需确认再套用
    if (view.dataVersion !== this.tableState().dataVersion) {
      const confirmed = window.confirm(
        `视图「${view.name}」保存之后订单数据已发生变更，列表与订单总额均已重算。仍要套用该旧视图吗？`,
      );
      if (!confirmed) {
        return;
      }
    }
    this.store.dispatch(TableActions.applyView({ view }));
  }

  deleteView(event: Event, id: string): void {
    event.stopPropagation();
    this.store.dispatch(TableActions.deleteView({ id }));
  }

  resetView(): void {
    this.store.dispatch(TableActions.setSort({ sort: { field: 'updatedAt', direction: 'desc' } }));
    this.store.dispatch(TableActions.setSearch({ search: '' }));
    this.clearFilter();
    this.setGroup(null);
  }

  exportCsv(): void {
    const columns = this.visibleColumns();
    const header = columns.map((column) => column.label).join(',');
    const rows = this.tableState().rows.map((row) =>
      columns.map((column) => `"${String(row[column.key] ?? '').replaceAll('"', '""')}"`).join(','),
    );
    const blob = new Blob([`\uFEFF${[header, ...rows].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `销售订单-第${this.tableState().page + 1}页.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private countConditions(group: FilterGroup): number {
    return group.children.reduce((count, child) => {
      if (child.kind === 'condition') return count + (child.value.trim() ? 1 : 0);
      return count + this.countConditions(child);
    }, 0);
  }

  private removeNode(group: FilterGroup, id: string): FilterGroup {
    return {
      ...group,
      children: group.children
        .filter((child) => child.id !== id)
        .map((child) => child.kind === 'group' ? this.removeNode(child, id) : child),
    };
  }
}
