window.memberPage = function () {
  var root = document.getElementById('member-root')
  return {
    memberId: root ? root.dataset.memberId : '',
    loginEnabled: root ? root.dataset.loginEnabled === 'true' : false,
    loginLoading: false,

    // ── Generic confirm modal ──────────────────────────────────────────
    modal: { open: false, title: '', body: '', confirmText: 'Confirm', danger: true, pending: false, onConfirm: null },

    openConfirm: function (title, body, onConfirm, opts) {
      this.modal = {
        open: true, title: title, body: body,
        confirmText: (opts && opts.confirmText) ? opts.confirmText : 'Confirm',
        danger: opts ? opts.danger !== false : true,
        pending: false, onConfirm: onConfirm,
      }
    },

    doConfirm: async function () {
      this.modal.pending = true
      try { await this.modal.onConfirm() } finally { this.modal.pending = false; this.modal.open = false }
    },

    // ── Permanent delete modal ─────────────────────────────────────────
    deleteModal: { open: false, memberName: '', inputName: '', pending: false },

    openDelete: function (memberName) {
      this.deleteModal = { open: true, memberName: memberName, inputName: '', pending: false }
    },

    doDelete: async function () {
      if (this.deleteModal.inputName.trim() !== this.deleteModal.memberName) {
        alert('Name did not match. Type exactly: ' + this.deleteModal.memberName)
        return
      }
      this.deleteModal.pending = true
      var r = await fetch('/api/members/' + this.memberId + '?action=permanent', { method: 'DELETE' })
      this.deleteModal.pending = false
      if (r.ok) { window.location.href = '/admin/members' }
      else { var e = await r.json(); alert(e.error || 'Failed to delete member') }
    },

    // ── Login access toggle ────────────────────────────────────────────
    toggleLogin: function () {
      var self = this
      var newVal = !this.loginEnabled
      this.openConfirm(
        (newVal ? 'Enable' : 'Disable') + ' login access',
        (newVal ? 'Enable' : 'Disable') + ' login access for this member?',
        async function () {
          self.loginLoading = true
          var r = await fetch('/api/members/' + self.memberId + '/login-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newVal }),
          })
          self.loginLoading = false
          if (r.ok) { self.loginEnabled = newVal }
          else { var e = await r.json(); alert(e.error || 'Failed to update login access') }
        },
        { confirmText: newVal ? 'Enable' : 'Disable', danger: false }
      )
    },

    // ── Archive ────────────────────────────────────────────────────────
    archive: function (memberName) {
      var self = this
      this.openConfirm(
        'Archive ' + memberName,
        'Archive ' + memberName + '? They will no longer appear in active lists.\n\nNote: you cannot archive a member with an active elected tenure.',
        async function () {
          var r = await fetch('/api/members/' + self.memberId, { method: 'DELETE' })
          if (r.ok) { window.location.href = '/admin/members' }
          else { var e = await r.json(); alert(e.error || 'Failed to archive member') }
        },
        { confirmText: 'Archive' }
      )
    },

    // ── Pay all dues for year ──────────────────────────────────────────
    payYear: function (yearStr, unpaidStr) {
      var self = this
      var year = parseInt(yearStr, 10)
      var months = (unpaidStr || '').split(',').map(Number).filter(Boolean)
      if (!months.length) return
      this.openConfirm(
        'Mark all paid — ' + year,
        'Mark all ' + months.length + ' unpaid month' + (months.length === 1 ? '' : 's') + ' for ' + year + ' as paid?',
        async function () {
          await Promise.all(months.map(function (month) {
            return fetch('/api/members/' + self.memberId + '/dues', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ year: year, month: month }),
            })
          }))
          window.location.reload()
        },
        { confirmText: 'Mark all paid', danger: false }
      )
    },

    // ── Individual due toggle ──────────────────────────────────────────
    toggleDue: async function (year, month, dueId) {
      var url = dueId
        ? '/api/members/' + this.memberId + '/dues/' + dueId
        : '/api/members/' + this.memberId + '/dues'
      var r = await fetch(url, {
        method: dueId ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: dueId ? undefined : JSON.stringify({ year: year, month: month }),
      })
      if (r.ok) { window.location.reload() }
      else { var e = await r.json(); alert(e.error || 'Failed to update dues') }
    },

    // ── Add to team (overview tab) ─────────────────────────────────────
    addTeamOverview: async function () {
      var sel = document.getElementById('overview-team-select')
      var teamId = sel ? sel.value : ''
      if (!teamId) { alert('Please select a team first.'); return }
      var isLead = document.getElementById('overview-team-lead-check') ? document.getElementById('overview-team-lead-check').checked : false
      var r = await fetch('/api/members/' + this.memberId + '/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, is_team_lead: isLead }),
      })
      if (r.ok) { window.location.reload() }
      else { var e = await r.json(); alert(e.error || 'Failed to add to team') }
    },

    // ── Remove from team ──────────────────────────────────────────────
    removeFromTeam: function (teamId) {
      var self = this
      this.openConfirm(
        'Remove from team',
        'Remove this member from the team?',
        async function () {
          var r = await fetch('/api/members/' + self.memberId + '/teams?team_id=' + teamId, { method: 'DELETE' })
          if (r.ok) { window.location.reload() }
          else { var e = await r.json(); alert(e.error || 'Failed to remove from team') }
        }
      )
    },

    // ── Assign role ───────────────────────────────────────────────────
    assignRole: async function () {
      var sel = document.getElementById('role-select')
      var roleId = sel ? sel.value : ''
      if (!roleId) { alert('Please select a role first.'); return }
      var r = await fetch('/api/members/' + this.memberId + '/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: roleId }),
      })
      if (r.ok) { window.location.reload() }
      else { var e = await r.json(); alert(e.error || 'Failed to assign role') }
    },

    // ── Revoke role ───────────────────────────────────────────────────
    revokeRole: function (roleId) {
      var self = this
      this.openConfirm(
        'Revoke role',
        'Revoke this role from the member?',
        async function () {
          var r = await fetch('/api/members/' + self.memberId + '/roles?role_id=' + roleId, { method: 'DELETE' })
          if (r.ok) { window.location.reload() }
          else { var e = await r.json(); alert(e.error || 'Failed to revoke role') }
        }
      )
    },

    // ── Delete DBS record ─────────────────────────────────────────────
    deleteDbs: function (dbsId) {
      var self = this
      this.openConfirm(
        'Delete DBS record',
        'Delete this DBS record? This action cannot be undone.',
        async function () {
          var r = await fetch('/api/dbs/' + dbsId, { method: 'DELETE' })
          if (r.ok) { window.location.reload() }
          else { var e = await r.json(); alert(e.error || 'Failed to delete DBS record') }
        }
      )
    },

    // ── Assign elected position ───────────────────────────────────────
    assignPosition: async function () {
      var positionId = document.getElementById('position-select') ? document.getElementById('position-select').value : ''
      var termStart = document.getElementById('position-term-start') ? document.getElementById('position-term-start').value : ''
      var electedBy = document.getElementById('position-elected-by') ? document.getElementById('position-elected-by').value : 'chapter_vote'
      if (!positionId) { alert('Please select a position first.'); return }
      if (!termStart) { alert('Please enter a term start date.'); return }
      var r = await fetch('/api/positions/' + positionId + '/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: this.memberId, term_start: termStart, elected_by: electedBy }),
      })
      if (r.ok) { window.location.reload() }
      else { var e = await r.json(); alert(e.error || 'Failed to assign position') }
    },

    // ── Remove elected position tenure ────────────────────────────────
    removeTenure: function (tenureId, positionId, positionTitle) {
      this.openConfirm(
        'Remove tenure',
        'Remove the "' + positionTitle + '" tenure record? This cannot be undone.',
        async function () {
          var r = await fetch('/api/positions/' + positionId + '/assign?tenure_id=' + tenureId, { method: 'DELETE' })
          if (r.ok) { window.location.reload() }
          else { var e = await r.json(); alert(e.error || 'Failed to remove tenure') }
        },
        { confirmText: 'Remove', danger: true }
      )
    },
  }
}
