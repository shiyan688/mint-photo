#!/usr/bin/env python3
"""Static integration checks only, deliberately not labelled Android lifecycle tests."""
from pathlib import Path
root = Path(__file__).resolve().parents[2]
activity = (root / 'app/src/main/java/com/qingyan/editor/MainActivity.java').read_text(encoding='utf-8')
payload = (root / 'app/src/main/java/com/qingyan/editor/ProjectBackupPayload.java').read_text(encoding='utf-8')
transfer = (root / 'app/src/main/java/com/qingyan/editor/ProjectBackupTransfer.java').read_text(encoding='utf-8')
checks = 0

def check(value, label):
    global checks
    assert value, label
    checks += 1

def method(name, next_name):
    return activity[activity.index(name):activity.index(next_name, activity.index(name))]

for name in ('beginProjectBackup', 'appendProjectBackup', 'finishProjectBackup', 'cancelProjectBackup'):
    check('@JavascriptInterface\n        public void '+name in activity, name+' bridge')
owner = method('    private ProjectJob ownedProjectJob(', '    private boolean isCurrentProjectJob(')
check('validRequestId(id)' in owner and 'projectJob.id.equals(id)' in owner, 'wrong ID cannot obtain current job')
cancel = method('        public void cancelProjectBackup(', '        @JavascriptInterface\n        public void savePreset')
check('ownedProjectJob(requestId)' in cancel and 'if (job != null)' in cancel, 'wrong ID cancel is a no-op')
append = method('    private void appendProjectChunk(', '    private void completeProjectBackup(')
check('ownedProjectJob(id)' in append and 'if (job == null)' in append, 'wrong ID chunk does not cancel current job')
check('job.inFlight || !Double.isFinite(requestedIndex)' in append and 'failProjectJob(job' in append, 'outstanding/repeated chunk fails only owner')
check('requestedIndex != Math.rint(requestedIndex)' in append and 'requestedIndex > Integer.MAX_VALUE' in append, 'fractional/nonfinite index rejected before narrowing')
check('!Double.isFinite(total)' in activity and 'total != Math.rint(total)' in activity, 'fractional/nonfinite total rejected before narrowing')
check('index != nextIndex' in transfer, 'receiver validates repeated/missing/out-of-order indices')
check(transfer.index('validateChunk(encoded); //') < transfer.index('Base64.getDecoder().decode(encoded)'), 'base64 allocation occurs after limit validation')
check('receivedBytes + bytes.length > expectedBytes' in transfer, 'declared byte length protected')
check('receivedBytes != expectedBytes' in transfer, 'finish requires exact total')
failed = method('    private void failProjectJob(', '    private void notifyProjectTransfer(')
check(failed.index('if (projectJob != job) return;') < failed.index('job.cancelled.set(true)'), 'stale job cannot clear new owner')
check(failed.index('cleanProjectJob(job);') < failed.index('finishExport(false, message);'), 'shared lock released only after serial cleanup')
check('!job.id.equals(pendingProjectId)' in failed, 'failed callback tied to request ID')
current = method('    private boolean isCurrentProjectJob(', '    private void appendProjectChunk(')
check('!destroyed' in current and 'projectJob == job' in current and '!job.cancelled.get()' in current, 'worker completion guarded by Activity and object identity')
restore = method('    private void restorePendingExport(', '    private void cleanOldExports(')
check('STATE_PROJECT_STREAMING' in restore and 'queuedProjectId = projectId' in restore, 'recreated streaming failure retains old ID')
check('STATE_EXPORT_COPYING' in restore and '上次保存结果尚未确认' in restore, 'copy-in-progress restores uncertainty, not retry/success')
check('pendingProjectId = projectId' in restore, 'picker restoration preserves request ID')
save = method('    @Override protected void onSaveInstanceState(', '    @Override protected void onPause(')
check('STATE_EXPORT_PROJECT_ID, pendingProjectId' in save and 'STATE_PROJECT_STREAMING, pendingExport == null' in save, 'state stores bounded identity/phase, not chunks')
check('base64' not in save and 'putByteArray' not in save, 'no source bytes in Android Bundle')
copy = method('    private void copyExport(', '    private static String readableError(')
check(copy.index('ProjectBackupPayload.read(check)') < copy.index('openOutputStream(destination, "wt")'), 'restored source revalidated before opening destination')
destroy = method('    @Override protected void onDestroy(', '    @android.annotation.TargetApi(33)')
check(destroy.index('interrupted.cancelled.set(true)') < destroy.index('fileWorker.shutdown();'), 'midstream teardown cancels before shutdown')
check('fileWorker.execute(() -> cleanProjectJob(interrupted))' in destroy, 'midstream cleanup serialized behind any accepted chunk')
check('ACTIVE_EXPORT_FILES.contains(file.getName())' in activity, 'replacement Activity cannot unlink predecessor active temporary file')
check('PROJECT_TIMEOUT_MS = 120000' in activity and 'postDelayed(projectTimeout' in activity, 'idle transfer timeout bounded')
check('projectHandler.postDelayed(projectImportTimeout, PROJECT_TIMEOUT_MS)' in activity and 'clearProjectImportTimeout();' in activity, 'bounded import-read timeout and cleanup')
check('onNativeProjectBackupExportResult(' in activity and 'JSONObject.quote(projectId)' in activity, 'final callback carries bounded request ID')
check('Intent.EXTRA_LOCAL_ONLY, true' in activity and 'ProjectBackupPayload.CHOOSER_PROJECT' in activity, 'project picker has advisory local-only hint')
check('!"content".equals(uri.getScheme())' in activity and '!"content".equals(destination.getScheme())' in activity, 'only picker content URIs')
validate = method('    private void validateProjectImport(', '    private void completeChooser(')
check('ProjectBackupPayload.read(in)' in validate and 'new Uri[]{uri}' in validate, 'JS receives same URI only after native independent bounded read')
check('chooserCallback != callback || chooserGeneration != generation' in validate, 'canceled/old chooser cannot affect new picker')
check('new byte[32 * 1024]' in payload and 'new byte[(int) sourceLength]' not in payload, 'streamed source hashing, no full original array')
check('keys.add(key)' in payload and 'MAX_DEPTH = 64' in payload, 'duplicate/depth enforcement')
manifest = (root/'app/src/main/AndroidManifest.xml').read_text()
check('settings.setBlockNetworkLoads(true)' in activity and 'android:usesCleartextTraffic="false"' in manifest, 'WebView stays network-blocked; optional AI uses native HTTPS only')
print(f'Project backup static native integration: {checks} checks passed (not Android runtime evidence).')
