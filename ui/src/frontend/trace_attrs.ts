// Copyright (C) 2020 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import m from 'mithril';
import {assertExists} from '../base/logging';
import {TraceUrlSource} from '../public/trace_source';
import {createPermalink} from './permalink';
import {showModal} from '../widgets/modal';
import {onClickCopy} from './clipboard';
import {globals} from './globals';
import {AppImpl} from '../core/app_impl';

export function isShareable() {
  return globals.isInternalUser && isDownloadable();
}

export function isDownloadable() {
  const traceSource = AppImpl.instance.trace?.traceInfo.source;
  if (traceSource === undefined) {
    return false;
  }
  if (traceSource.type === 'ARRAY_BUFFER' && traceSource.localOnly) {
    return false;
  }
  if (traceSource.type === 'HTTP_RPC') {
    return false;
  }
  return true;
}

export async function shareTrace() {
  const traceSource = assertExists(AppImpl.instance.trace?.traceInfo.source);
  const traceUrl = (traceSource as TraceUrlSource).url ?? '';

  // If the trace is not shareable (has been pushed via postMessage()) but has
  // a url, create a pseudo-permalink by echoing back the URL.
  if (!isShareable()) {
    const msg = [
      m(
        'p',
        'This trace was opened by an external site and as such cannot ' +
          'be re-shared preserving the UI state.',
      ),
    ];
    if (traceUrl) {
      msg.push(m('p', 'By using the URL below you can open this trace again.'));
      msg.push(m('p', 'Clicking will copy the URL into the clipboard.'));
      msg.push(createTraceLink(traceUrl, traceUrl));
    }

    showModal({
      title: 'Cannot create permalink from external trace',
      content: m('div', msg),
    });
    return;
  }

  if (!isShareable() || !isTraceLoaded()) return;

  const result = confirm(
    `Upload UI state and generate a permalink. ` +
      `The trace will be accessible by anybody with the permalink.`,
  );
  if (result) {
    AppImpl.instance.analytics.logEvent('Trace Actions', 'Create permalink');
    return await createPermalink({mode: 'APP_STATE'});
  }
}

export function createTraceLink(title: string, url: string) {
  if (url === '') {
    return m('a.trace-file-name', title);
  }
  const linkProps = {
    href: url,
    title: 'Click to copy the URL',
    target: '_blank',
    onclick: onClickCopy(url),
  };
  return m('a.trace-file-name', linkProps, title);
}

export function isTraceLoaded(): boolean {
  return AppImpl.instance.trace !== undefined;
}

export function getCurrentTraceUrl(): undefined | string {
  const source = AppImpl.instance.trace?.traceInfo.source;
  if (source && source.type === 'URL') {
    return source.url;
  }
  return undefined;
}
