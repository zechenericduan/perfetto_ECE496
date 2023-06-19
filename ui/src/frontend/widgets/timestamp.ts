// Copyright (C) 2023 The Android Open Source Project
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

import {Actions} from '../../common/actions';
import {Timecode, toDomainTime} from '../../common/time';
import {Anchor} from '../anchor';
import {copyToClipboard} from '../clipboard';
import {globals} from '../globals';
import {Icons} from '../semantic_icons';
import {TPTimestamp} from '../sql_types';

import {MenuItem, PopupMenu2} from './menu';

// import {MenuItem, PopupMenu2} from './menu';

interface TimestampAttrs {
  // The timestamp to print, this should be the absolute, raw timestamp as
  // found in trace processor.
  ts: TPTimestamp;
  extraMenuItems?: m.Child[];
}

export class Timestamp implements m.ClassComponent<TimestampAttrs> {
  view({attrs}: m.Vnode<TimestampAttrs>) {
    const {ts} = attrs;
    return m(
        PopupMenu2,
        {
          trigger: m(
              Anchor,
              {
                onmouseover: () => {
                  globals.dispatch(Actions.setHoverCursorTimestamp({ts}));
                },
                onmouseout: () => {
                  globals.dispatch(Actions.setHoverCursorTimestamp({ts: -1n}));
                },
              },
              renderTimecode(ts)),
        },
        m(MenuItem, {
          icon: Icons.Copy,
          label: `Copy raw value`,
          onclick: () => {
            copyToClipboard(ts.toString());
          },
        }),
        ...(attrs.extraMenuItems ?? []),
    );
  }
}

export function renderTimecode(ts: TPTimestamp): m.Children {
  const relTime = toDomainTime(ts);
  const {dhhmmss, millis, micros, nanos} = new Timecode(relTime);
  return m(
      'span.pf-timecode',
      m('span.pf-timecode-hms', dhhmmss),
      '.',
      m('span.pf-timecode-millis', millis),
      m('span.pf-timecode-micros', micros),
      m('span.pf-timecode-nanos', nanos),
  );
}
