// Copyright (C) 2024 The Android Open Source Project
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
import {Gate} from '../base/mithril_utils';
import {EmptyState} from '../widgets/empty_state';
import {
  DragHandle,
  Tab,
  TabDropdownEntry,
  getDefaultDetailsHeight,
} from './drag_handle';
import {raf} from '../core/raf_scheduler';
import {Monitor} from '../base/monitor';
import {AsyncLimiter} from '../base/async_limiter';
import {TrackEventDetailsPanel} from '../public/details_panel';
import {DetailsShell} from '../widgets/details_shell';
import {GridLayout, GridLayoutColumn} from '../widgets/grid_layout';
import {Section} from '../widgets/section';
import {Tree, TreeNode} from '../widgets/tree';
import {TraceImpl, TraceImplAttrs} from '../core/trace_impl';

interface TabWithContent extends Tab {
  content: m.Children;
}

export type TabPanelAttrs = TraceImplAttrs;

export class TabPanel implements m.ClassComponent<TabPanelAttrs> {
  private readonly trace: TraceImpl;
  private readonly selectionMonitor = new Monitor([
    () => this.trace.selection.selection,
  ]);
  private readonly limiter = new AsyncLimiter();
  // Tabs panel starts collapsed.
  private detailsHeight = 0;
  private fadeContext = new FadeContext();
  private hasBeenDragged = false;

  constructor({attrs}: m.CVnode<TabPanelAttrs>) {
    this.trace = attrs.trace;
  }

  // This stores the current track event details panel + isLoading flag. It gets
  // created in a render cycle when we notice a change in the current selection
  // object and it is a "track event" type selection. From there, we create a
  // new details panel, wrap it with an isLoading flag, and kick off the
  // detailsPanel.load() function. When this function resolves, isLoading is set
  // to false.
  private trackEventDetailsPanel?: {
    detailsPanel: TrackEventDetailsPanel;
    isLoading: boolean;
  };

  view() {
    const tabMan = this.trace.tabs;
    const tabList = this.trace.tabs.openTabsUri;

    const resolvedTabs = tabMan.resolveTabs(tabList);
    const tabs = resolvedTabs.map(({uri, tab: tabDesc}): TabWithContent => {
      if (tabDesc) {
        return {
          key: uri,
          hasCloseButton: true,
          title: tabDesc.content.getTitle(),
          content: tabDesc.content.render(),
        };
      } else {
        return {
          key: uri,
          hasCloseButton: true,
          title: 'Tab does not exist',
          content: undefined,
        };
      }
    });

    if (
      !this.hasBeenDragged &&
      (tabs.length > 0 || this.trace.selection.selection.kind !== 'empty')
    ) {
      this.detailsHeight = getDefaultDetailsHeight();
    }

    // Add the permanent current selection tab to the front of the list of tabs
    tabs.unshift({
      key: 'current_selection',
      title: 'Current Selection',
      content: this.renderCSTabContentWithFading(),
    });

    const tabDropdownEntries = this.trace.tabs.tabs
      .filter((tab) => tab.isEphemeral === false)
      .map(({content, uri}): TabDropdownEntry => {
        return {
          key: uri,
          title: content.getTitle(),
          onClick: () => this.trace.tabs.toggleTab(uri),
          checked: this.trace.tabs.isOpen(uri),
        };
      });

    return [
      m(DragHandle, {
        resize: (height: number) => {
          this.detailsHeight = Math.max(height, 0);
          this.hasBeenDragged = true;
        },
        height: this.detailsHeight,
        tabs,
        currentTabKey: this.trace.tabs.currentTabUri,
        tabDropdownEntries,
        onTabClick: (uri) => this.trace.tabs.showTab(uri),
        onTabClose: (uri) => this.trace.tabs.hideTab(uri),
      }),
      m(
        '.details-panel-container',
        {
          style: {height: `${this.detailsHeight}px`},
        },
        tabs.map(({key, content}) => {
          const active = key === this.trace.tabs.currentTabUri;
          return m(Gate, {open: active}, content);
        }),
      ),
    ];
  }

  private renderCSTabContentWithFading(): m.Children {
    const section = this.renderCSTabContent();
    if (section.isLoading) {
      return m(FadeIn, section.content);
    } else {
      return m(FadeOut, {context: this.fadeContext}, section.content);
    }
  }

  private maybeLoadDetailsPanel() {
    // Detect changes to the selection (only works if we assume the selection
    // object is immutable)
    if (this.selectionMonitor.ifStateChanged()) {
      const currentSelection = this.trace.selection.selection;
      // Show single selection panels if they are registered
      if (currentSelection.kind !== 'track_event') {
        this.trackEventDetailsPanel = undefined;
        return;
      }

      const td = this.trace.tracks.getTrack(currentSelection.trackUri);
      if (!td) {
        this.trackEventDetailsPanel = undefined;
        return;
      }

      const detailsPanel = td.track.detailsPanel?.(currentSelection);
      if (!detailsPanel) {
        this.trackEventDetailsPanel = undefined;
        return;
      }

      const renderable = {
        detailsPanel,
        isLoading: true,
      };
      this.limiter.schedule(async () => {
        await detailsPanel?.load?.(currentSelection);
        renderable.isLoading = false;
        raf.scheduleFullRedraw();
      });

      this.trackEventDetailsPanel = renderable;
    }
  }

  private renderCSTabContent(): {isLoading: boolean; content: m.Children} {
    // Always update the details panel
    this.maybeLoadDetailsPanel();

    const currentSelection = this.trace.selection.selection;
    if (currentSelection.kind === 'empty') {
      return {
        isLoading: false,
        content: m(
          EmptyState,
          {
            className: 'pf-noselection',
            title: 'Nothing selected',
          },
          'Selection details will appear here',
        ),
      };
    }

    if (currentSelection.kind === 'track') {
      return {
        isLoading: false,
        content: this.renderTrackDetailsPanel(currentSelection.trackUri),
      };
    }

    // If there is a details panel present, show this
    const dpRenderable = this.trackEventDetailsPanel;
    if (dpRenderable) {
      return {
        isLoading: dpRenderable?.isLoading ?? false,
        content: dpRenderable?.detailsPanel.render(),
      };
    }

    // Get the first "truthy" details panel
    const detailsPanels = this.trace.tabs.detailsPanels.map((dp) => {
      return {
        content: dp.render(currentSelection),
        isLoading: dp.isLoading?.() ?? false,
      };
    });

    const panel = detailsPanels.find(({content}) => content);

    if (panel) {
      return panel;
    } else {
      return {
        isLoading: false,
        content: m(
          EmptyState,
          {
            className: 'pf-noselection',
            title: 'No details available',
            icon: 'warning',
          },
          `Selection kind: '${currentSelection.kind}'`,
        ),
      };
    }
  }

  private renderTrackDetailsPanel(trackUri: string) {
    const track = this.trace.tracks.getTrack(trackUri);
    if (track) {
      return m(
        DetailsShell,
        {title: 'Track', description: track.title},
        m(
          GridLayout,
          m(
            GridLayoutColumn,
            m(
              Section,
              {title: 'Details'},
              m(
                Tree,
                m(TreeNode, {left: 'Name', right: track.title}),
                m(TreeNode, {left: 'URI', right: track.uri}),
                m(TreeNode, {left: 'Plugin ID', right: track.pluginId}),
                m(
                  TreeNode,
                  {left: 'Tags'},
                  track.tags &&
                    Object.entries(track.tags).map(([key, value]) => {
                      return m(TreeNode, {left: key, right: value?.toString()});
                    }),
                ),
              ),
            ),
          ),
        ),
      );
    } else {
      return undefined; // TODO show something sensible here
    }
  }
}

const FADE_TIME_MS = 50;

class FadeContext {
  private resolver = () => {};

  putResolver(res: () => void) {
    this.resolver = res;
  }

  resolve() {
    this.resolver();
    this.resolver = () => {};
  }
}

interface FadeOutAttrs {
  context: FadeContext;
}

class FadeOut implements m.ClassComponent<FadeOutAttrs> {
  onbeforeremove({attrs}: m.VnodeDOM<FadeOutAttrs>): Promise<void> {
    return new Promise((res) => {
      attrs.context.putResolver(res);
      setTimeout(res, FADE_TIME_MS);
    });
  }

  oncreate({attrs}: m.VnodeDOM<FadeOutAttrs>) {
    attrs.context.resolve();
  }

  view(vnode: m.Vnode<FadeOutAttrs>): void | m.Children {
    return vnode.children;
  }
}

class FadeIn implements m.ClassComponent {
  private show = false;

  oncreate(_: m.VnodeDOM) {
    setTimeout(() => {
      this.show = true;
      raf.scheduleFullRedraw();
    }, FADE_TIME_MS);
  }

  view(vnode: m.Vnode): m.Children {
    return this.show ? vnode.children : undefined;
  }
}
