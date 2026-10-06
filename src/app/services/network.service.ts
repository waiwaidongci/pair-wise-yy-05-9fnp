import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 网络状态服务：封装浏览器 online/offline 事件，
 * 供断网待同步、回网补交使用。
 */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  private readonly onlineSubject = new BehaviorSubject<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  readonly online$: Observable<boolean> = this.onlineSubject.asObservable();

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }
    fromEvent(window, 'online')
      .pipe(map(() => true))
      .subscribe((online) => this.onlineSubject.next(online));
    fromEvent(window, 'offline')
      .pipe(map(() => false))
      .subscribe((online) => this.onlineSubject.next(online));
  }

  get isOnline(): boolean {
    return this.onlineSubject.value;
  }
}
