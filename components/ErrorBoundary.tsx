import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isChunkLoadError } from '../utils/lazyWithRetry';

interface Props {
  children: ReactNode;
  /** 出错时额外提示 */
  label?: string;
}

interface State {
  error: Error | null;
}

/** 防止单个模块崩溃导致整页空白 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label || 'render', error, info.componentStack);
    // 部署后旧 chunk 404：自动硬刷新一次
    if (typeof window !== 'undefined' && isChunkLoadError(error)) {
      const flag = 'tp_chunk_reload_boundary';
      if (!sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, '1');
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.error) {
      const chunkMiss = isChunkLoadError(this.state.error);
      return (
        <div className="max-w-xl mx-auto mt-16 text-center p-8 bg-white rounded-3xl border border-red-100 shadow-xl">
          <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 text-red-500">
            <AlertTriangle size={32} />
          </div>
          <h3 className="text-lg font-black text-slate-800 mb-2">页面渲染出错</h3>
          <p className="text-sm text-slate-500 font-medium mb-4">
            {chunkMiss
              ? '检测到版本已更新，本地还在加载旧文件。请强制刷新页面后再打开该模块。'
              : this.props.label
                ? `${this.props.label} 加载失败。可尝试重新打开该记录，或返回其它模块。`
                : '内容加载失败。可尝试重新打开该记录，或返回其它模块。'}
          </p>
          <div className="bg-slate-100 p-3 rounded-xl text-[11px] font-mono text-left mb-5 break-words text-slate-600 max-h-32 overflow-y-auto">
            {this.state.error.message}
          </div>
          <button
            type="button"
            onClick={() => {
              if (chunkMiss) {
                window.location.reload();
                return;
              }
              this.setState({ error: null });
            }}
            className="inline-flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-600"
          >
            <RefreshCw size={16} /> {chunkMiss ? '强制刷新' : '重试'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
