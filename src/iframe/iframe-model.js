import _ from 'lodash'
import { action } from 'mobx'
import runner from '../lib/runner'

export default class IframeModel {
  constructor ({ state, detachDom, removeHeadStyles, restoreDom, highlightEl, snapshotControls }) {
    this.state = state
    this.detachDom = detachDom
    this.removeHeadStyles = removeHeadStyles
    this.restoreDom = restoreDom
    this.highlightEl = highlightEl
    this.snapshotControls = snapshotControls

    this._reset()
  }

  listen () {
    runner.on('run:start', action('run:start', this._beforeRun))
    runner.on('run:end', action('run:start', this._afterRun))

    runner.on('viewport', action('viewport', this._updateViewport))
    runner.on('config', action('config', (config) => {
      this._updateViewport(_.map(config, 'viewportHeight', 'viewportWidth'))
    }))

    runner.on('url:changed', action('url:changed', this._updateUrl))
    runner.on('page:loading', action('page:loading', this._updateLoading))

    runner.on('show:snapshot', action('show:snapshot', this._setSnapshots))
    runner.on('hide:snapshot', action('hide:snapshot', this._clearSnapshots))

    runner.on('pin:snapshot', action('pin:snapshot', this._pinSnapshot))
    runner.on('unpin:snapshot', action('unpin:snapshot', this._unpinSnapshot))
  }

  _beforeRun = () => {
    this.state.isRunning = true
    this._reset()
    this._clearMessage()
  }

  _afterRun = () => {
    this.state.isRunning = false
  }

  _updateViewport = ({ viewportWidth, viewportHeight }) => {
    this.state.updateDimensions(viewportWidth, viewportHeight)
  }

  _updateUrl = (url) => {
    this.state.url = url
  }

  _updateLoading = (loading) => {
    this.state.loading = loading
  }

  _clearMessage = () => {
    this.state.clearMessage()
  }

  _setSnapshots = (snapshotProps) => {
    if (this.isSnapshotPinned) return

    if (this.state.isRunning) {
      return this._testsRunningError()
    }

    const { snapshots } = snapshotProps

    if (!snapshots) {
      this._clearSnapshots()
      this.state.messageTitle = 'The snapshot is missing. Displaying current state of the DOM.'
      this.state.messageType = 'warning'
      return
    }

    this.state.highlightUrl = true

    if (!this.originalState) {
      this._storeOriginalState()
    }

    this.detachedId = snapshotProps.id

    this._updateViewport(snapshotProps)
    this._updateUrl(snapshotProps.url)

    clearInterval(this.intervalId)

    const revert = action('revert:snapshot', this._showSnapshot)

    if (snapshots.length > 1) {
      let i = 0
      this.intervalId = setInterval(() => {
        if (this.isSnapshotPinned) return

        i += 1
        if (!snapshots[i]) {
          i = 0
        }

        revert(snapshots[i], snapshotProps)
      }, 800)
    }

    revert(snapshots[0], snapshotProps)
  }

  _showSnapshot = (snapshot, snapshotProps) => {
    this.state.messageTitle = 'DOM Snapshot'
    this.state.messageDescription = snapshot.name
    this.state.messageType = ''

    this.restoreDom(snapshot)

    if (snapshotProps.$el) {
      this.highlightEl(snapshot, snapshotProps)
    }
  }

  _clearSnapshots = () => {
    if (this.isSnapshotPinned) return

    clearInterval(this.intervalId)

    this.state.highlightUrl = false

    if (!this.originalState || !this.originalState.body) {
      return this._clearMessage()
    }

    const previousDetachedId = this.detachedId

    // process on next tick so we don't restore the dom if we're
    // about to receive another 'show:snapshot' event, else that would
    // be a huge waste
    setTimeout(action('clear:snapshots:next:tick', () => {
      // we want to only restore the dom if we haven't received
      // another snapshot by the time this function runs
      if (previousDetachedId !== this.detachedId) return

      this._updateViewport(this.originalState)
      this._updateUrl(this.originalState.url)
      this.restoreDom(this.originalState)
      this._clearMessage()

      this.originalState = null
      this.detachedId = null
    }))
  }

  _pinSnapshot = (snapshotProps) => {
    const { snapshots } = snapshotProps

    if (!snapshots || !snapshots.length) {
      return
    }

    clearInterval(this.intervalId)

    this.isSnapshotPinned = true
    this.state.messageTitle = 'DOM Snapshot (pinned)'
    this.state.messageControls = this.snapshotControls(snapshotProps)
  }

  _unpinSnapshot = () => {
    this.isSnapshotPinned = false
    this.state.messageTitle = 'DOM Snapshot'
    this.state.messageControls = null
    this.state.snapshot.showingHighlights = true
    this._clearSnapshots()
  }

  _testsRunningError () {
    this.state.messageTitle = 'Cannot show Snapshot while tests are running'
    this.state.messageType = 'warning'
  }

  _storeOriginalState () {
    const { body, htmlClasses, headStyles, bodyStyles } = this.detachDom()

    this.originalState = {
      body,
      htmlClasses,
      headStyles,
      bodyStyles,
      url: this.state.url,
      viewportWidth: this.state.width,
      viewportHeight: this.state.height,
    }
  }

  _reset () {
    this.detachedId = null
    this.intervalId = null
    this.originalState = null
    this.isSnapshotPinned = false
  }
}
