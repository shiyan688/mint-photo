package com.qingyan.editor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Local asset editor with an explicit, cancellable native HTTPS image API bridge. */
@SuppressWarnings("deprecation")
public final class MainActivity extends Activity {
    private static final String APP_URL = "file:///android_asset/index.html";
    private static final int PICK_DOCUMENT = 1101;
    private static final int SAVE_DOCUMENT = 1102;
    private static final String STATE_EXPORT_FILE = "pending_export_file";
    private static final String STATE_EXPORT_MIME = "pending_export_mime";
    private static final String STATE_EXPORT_NAME = "pending_export_name";
    private static final String STATE_EXPORT_KIND = "pending_export_kind";
    private static final String STATE_EXPORT_COPYING = "pending_export_copying";
    private static final String STATE_EXPORT_PROJECT_ID = "pending_export_project_id";
    private static final String STATE_PROJECT_STREAMING = "project_streaming";
    private static final String EXPORT_PROJECT = "project";
    private static final long PROJECT_TIMEOUT_MS = 120000;
    private static final String EXPORT_IMAGE = "image";
    private static final String EXPORT_PRESET = "preset";
    // A replacement Activity must not remove a temp file still being prepared or copied by
    // its destroyed predecessor. This set contains cache filenames only, never user URIs.
    private static final Set<String> ACTIVE_EXPORT_FILES = ConcurrentHashMap.newKeySet();

    private final ExecutorService fileWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService presetImportWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService portraitWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService aiWorker = Executors.newSingleThreadExecutor();
    private AiJob aiJob;
    private static final class AiJob {
        final String id;
        final AiImageClient client = new AiImageClient();
        Runnable timeout;
        AiJob(String id) { this.id = id; }
    }
    private final AtomicBoolean portraitBusy = new AtomicBoolean(false);
    // Accessed only on the UI thread. A callback belongs to the page that started it.
    private long portraitPageGeneration = 0;
    private PortraitAnalyzer portraitAnalyzer;
    private final AtomicBoolean exportBusy = new AtomicBoolean(false);
    private WebView webView;
    private ValueCallback<Uri[]> chooserCallback;
    private int chooserKind;
    private int chooserGeneration;
    private CancellationSignal chooserCancellation;
    private File pendingExport;
    private String pendingMime;
    private String pendingName;
    private String pendingKind;
    private String pendingProjectId;
    private String queuedProjectId;
    private ProjectJob projectJob;
    private final Handler projectHandler = new Handler(Looper.getMainLooper());
    private Runnable projectTimeout;
    private Runnable projectImportTimeout;
    private String queuedExportMessage;
    private String queuedExportKind;
    private boolean queuedExportSuccess;
    private volatile boolean ready;
    private volatile boolean destroyed;
    private boolean backRequested;
    private boolean restoredPendingExport;
    private boolean preservePendingExport;
    private boolean copyingExport;
    private AlertDialog exitDialog;
    private Runnable unregisterBack;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        restorePendingExport(savedInstanceState);
        cleanOldExports();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.mint_background));
        configureInsets(root);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.requestApplyInsets();
        configureWebView();
        if (Build.VERSION.SDK_INT >= 33) {
            unregisterBack = BackApi33.register(this, this::requestBack);
        }
        // The WebView, not Android instance state, owns draft persistence in IndexedDB.
        // Avoid serializing image-containing page state into a size-limited Bundle.
        webView.loadUrl(APP_URL);
    }

    private void configureInsets(FrameLayout root) {
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout());
                int keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom;
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard));
            }
            // API 26–29 use the standard fitted window and adjustResize without duplicate padding.
            return insets;
        });
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Android explicitly permits android_asset even when ordinary file access is off.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // User-selected, validated photos or JSON recipes only.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setBackgroundColor(getColor(R.color.mint_background));
        webView.addJavascriptInterface(new ImageBridge(), "Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAppDocument(request.getUrl().toString()) || !request.isForMainFrame();
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isAppDocument(url);
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();
                if ("file".equals(uri.getScheme()) && (uri.getAuthority() == null || uri.getAuthority().isEmpty())
                        && path != null && path.startsWith("/android_asset/")
                        && !path.contains("..") && !path.contains("\\")) {
                    return null;
                }
                // Canvas-generated filter thumbnails use raster data URLs. Never allow a data
                // document or SVG/HTML. blob: file-input images are not intercepted by WebView.
                String url = uri.toString();
                if (!request.isForMainFrame() && "data".equals(uri.getScheme())
                        && (url.startsWith("data:image/jpeg;base64,")
                        || url.startsWith("data:image/png;base64,")
                        || url.startsWith("data:image/webp;base64,"))) {
                    return null;
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                portraitPageGeneration++;
                cancelAi(false);
                ready = false;
                if (!isAppDocument(url)) {
                    view.stopLoading();
                    view.removeJavascriptInterface("Android");
                }
            }

            @Override public void onPageFinished(WebView view, String url) {
                ready = isAppDocument(url);
                if (ready && queuedExportMessage != null) {
                    String message = queuedExportMessage;
                    queuedExportMessage = null;
                    notifyExport(queuedExportSuccess, message, queuedExportKind, queuedProjectId);
                    queuedProjectId = null;
                }
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    ready = false;
                    Toast.makeText(MainActivity.this, R.string.load_failed, Toast.LENGTH_LONG).show();
                }
            }

            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                cancelAi(false);
                ready = false;
                cancelChooser();
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
                webView = null;
                Toast.makeText(MainActivity.this, R.string.renderer_failed, Toast.LENGTH_LONG).show();
                finish();
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                       FileChooserParams params) {
                if (!ready || destroyed) {
                    callback.onReceiveValue(null);
                    return true;
                }
                // Do not replace an active picker/read: its eventual result must never be
                // mistaken for a later request of a different content type.
                if (chooserCallback != null || params.getMode() != FileChooserParams.MODE_OPEN) {
                    callback.onReceiveValue(null);
                    return true;
                }
                int kind = ProjectBackupPayload.chooserKind(params.getAcceptTypes());
                if (kind == PresetPayload.CHOOSER_INVALID) {
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, R.string.import_invalid, Toast.LENGTH_LONG).show();
                    return true;
                }
                chooserCallback = callback;
                chooserKind = kind;
                chooserGeneration++;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(kind == ProjectBackupPayload.CHOOSER_PROJECT ? ProjectBackupPayload.MIME
                        : kind == PresetPayload.CHOOSER_PRESET ? PresetPayload.MIME : "image/*");
                if (kind == ProjectBackupPayload.CHOOSER_PROJECT) {
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{ProjectBackupPayload.MIME, "application/octet-stream"});
                    // Advisory only: some document providers can still sync to a cloud account.
                    intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
                }
                if (kind == PresetPayload.CHOOSER_PRESET) {
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{PresetPayload.MIME, "application/octet-stream"});
                }
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(intent, PICK_DOCUMENT);
                } catch (ActivityNotFoundException | SecurityException error) {
                    cancelChooser();
                    Toast.makeText(MainActivity.this, R.string.import_unavailable, Toast.LENGTH_LONG).show();
                }
                return true;
            }

            @Override public void onPermissionRequest(android.webkit.PermissionRequest request) {
                request.deny();
            }

            @Override public void onGeolocationPermissionsShowPrompt(String origin,
                    android.webkit.GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
        });
        // Downloads and external intents are never opened by this offline editor.
        webView.setDownloadListener((url, agent, disposition, mime, length) -> { });
    }

    private void beginAi(String payload, String id) {
        if (destroyed || !ready || webView == null || !isAppDocument(webView.getUrl())) return;
        if (aiJob != null) { notifyAi(id, null, "已有 AI 请求，请先取消"); return; }
        AiJob job = new AiJob(id); aiJob = job;
        job.timeout = () -> { if (aiJob == job) { cancelAi(false); notifyAi(id, null, "AI 请求超时；服务可能已产生费用"); } };
        projectHandler.postDelayed(job.timeout, 180000);
        aiWorker.execute(() -> {
            String image = null, error = null;
            try {
                JSONObject json = new JSONObject(payload);
                AiImageClient.Request request = new AiImageClient.Request(json.getString("endpoint"), json.getString("key"),
                        json.getString("model"), json.getString("prompt"), json.getString("image"), json.optString("mask", null));
                JSONObject result = new JSONObject(job.client.edit(request));
                String b64 = result.getJSONArray("data").getJSONObject(0).getString("b64_json");
                AiImageClient.decodePng("data:image/png;base64," + b64);
                image = "data:image/png;base64," + b64;
            } catch (AiImageClient.UserFailure e) {
                error = e.getMessage();
            } catch (IOException e) {
                // Exception text from sockets may include service-controlled URLs. Never echo it.
                error = "AI 请求失败或被取消；请检查网络、接口兼容性、模型和余额";
            } catch (Exception e) {
                error = "服务未返回有效 b64_json PNG，或请求参数无效";
            } catch (OutOfMemoryError e) {
                error = "图片占用内存过大，请缩小后重试";
            }
            final String output = image, message = error;
            runOnUiThread(() -> {
                if (aiJob != job || destroyed) return;
                aiJob = null; projectHandler.removeCallbacks(job.timeout);
                notifyAi(id, output, message);
            });
        });
    }

    private void cancelAi(boolean notify) {
        AiJob job = aiJob; aiJob = null;
        if (job == null) return;
        job.client.cancel(); projectHandler.removeCallbacks(job.timeout);
        if (notify) notifyAi(job.id, null, "请求已取消（退出界面或切至后台）；服务可能已产生费用");
    }

    private void notifyAi(String id, String image, String error) {
        if (destroyed || !ready || webView == null || !isAppDocument(webView.getUrl())) return;
        webView.evaluateJavascript("window.MintAiTransport&&window.MintAiTransport.receive(" + JSONObject.quote(id)
                + "," + (image == null ? "null" : JSONObject.quote(image)) + ","
                + (error == null ? "null" : JSONObject.quote(error)) + ")", null);
    }

    private static boolean isAppDocument(String url) {
        return APP_URL.equals(url) || (url != null && url.startsWith(APP_URL + "#"));
    }

    public final class ImageBridge {
        @JavascriptInterface
        public String samplePng(String id) {
            // Fixed bundled assets only. Do not relax file-origin isolation or expose paths.
            if (destroyed || !ready) return "";
            String asset = "portrait".equals(id) ? "demo/astronaut.png"
                    : "studio".equals(id) ? "demo/mint-portrait.png" : null;
            if (asset == null) return "";
            try (InputStream in = getAssets().open(asset);
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16384];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (out.size() + count > 3 * 1024 * 1024) return "";
                    out.write(buffer, 0, count);
                }
                return "data:image/png;base64," + android.util.Base64.encodeToString(
                        out.toByteArray(), android.util.Base64.NO_WRAP);
            } catch (IOException error) {
                return "";
            }
        }

        @JavascriptInterface
        public void editImage(String payload, String requestId) {
            if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,96}")) return;
            if (payload == null || payload.length() > AiImageClient.MAX_JSON) {
                runOnUiThread(() -> notifyAi(requestId, null, "请求超过20MiB"));
                return;
            }
            runOnUiThread(() -> beginAi(payload, requestId));
        }

        @JavascriptInterface
        public void cancelAiEdit(String requestId) {
            runOnUiThread(() -> { if (aiJob != null && aiJob.id.equals(requestId)) cancelAi(true); });
        }
        @JavascriptInterface
        public boolean isExportBusy() {
            // Read-only bridge-thread check. A recreated page must not create a new JS job
            // while a previous native picker/write is still pending. Never touch WebView
            // off the UI thread, and fail closed during page loading or Activity teardown.
            return destroyed || !ready || exportBusy.get();
        }

        @JavascriptInterface
        public void analyzePortrait(String dataUrl, String requestId, String kind) {
            // Never expose native user-image file access. JS supplies current canvas pixels.
            if (requestId == null || requestId.length() > 96) return;
            runOnUiThread(() -> beginPortrait(dataUrl, requestId, kind));
        }

        @JavascriptInterface
        public void saveImage(String dataUrl, String fileName, String mimeType) {
            // Bridge calls arrive on WebView's bridge thread. All view work goes to the UI thread.
            runOnUiThread(() -> beginExport(dataUrl, fileName, mimeType));
        }

        @JavascriptInterface
        public void beginProjectBackup(String requestId, String fileName, double totalBytes) {
            runOnUiThread(() -> startProjectBackup(requestId, fileName, totalBytes));
        }

        @JavascriptInterface
        public void appendProjectBackup(String requestId, double index, String base64) {
            runOnUiThread(() -> appendProjectChunk(requestId, index, base64));
        }

        @JavascriptInterface
        public void finishProjectBackup(String requestId) {
            runOnUiThread(() -> completeProjectBackup(requestId));
        }

        @JavascriptInterface
        public void cancelProjectBackup(String requestId) {
            runOnUiThread(() -> {
                ProjectJob job = ownedProjectJob(requestId);
                if (job != null) failProjectJob(job, "已取消项目备份，原项目仍在。");
            });
        }

        @JavascriptInterface
        public void savePreset(String jsonString, String fileName) {
            runOnUiThread(() -> beginPresetExport(jsonString, fileName));
        }
    }

    /** UI owns the session; only fileWorker accesses the receiver and its stream. */
    private static final class ProjectJob {
        final String id, name;
        final long total;
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        ProjectBackupTransfer transfer;
        boolean inFlight = true;
        ProjectJob(String id, String name, long total) { this.id = id; this.name = name; this.total = total; }
    }

    private void startProjectBackup(String id, String name, double total) {
        if (!ProjectBackupPayload.validRequestId(id)) return;
        if (!ready || destroyed || webView == null || !isAppDocument(webView.getUrl())) return;
        if (!Double.isFinite(total) || total != Math.rint(total)
                || total <= ProjectBackupPayload.HEADER_BYTES || total > ProjectBackupPayload.MAX_BYTES) {
            ProjectJob owned = ownedProjectJob(id);
            if (owned != null) failProjectJob(owned, "项目备份大小无效。");
            else notifyProjectTransfer(id, "error", -1, "项目备份大小无效。");
            return;
        }
        if (!exportBusy.compareAndSet(false, true)) {
            // A duplicate begin from the owner is corruption; a different ID cannot cancel it.
            ProjectJob owned = ownedProjectJob(id);
            if (owned != null) failProjectJob(owned, "项目备份传输已中断，请重新导出。");
            else notifyProjectTransfer(id, "error", -1, "请先完成当前导出。");
            return;
        }
        ProjectJob job = new ProjectJob(id, ProjectBackupPayload.fileName(name), (long) total);
        projectJob = job;
        pendingKind = EXPORT_PROJECT;
        pendingProjectId = id;
        armProjectTimeout(job);
        fileWorker.execute(() -> {
            try {
                if (job.cancelled.get()) return;
                job.transfer = new ProjectBackupTransfer(getCacheDir(), job.id, job.total);
                ACTIVE_EXPORT_FILES.add(job.transfer.file.getName());
                if (job.cancelled.get()) { cleanProjectJob(job); return; }
                runOnUiThread(() -> {
                    if (!isCurrentProjectJob(job)) return;
                    job.inFlight = false;
                    armProjectTimeout(job);
                    notifyProjectTransfer(job.id, "ready", -1, "");
                });
            } catch (IOException | RuntimeException | OutOfMemoryError error) {
                runOnUiThread(() -> failProjectJob(job, "项目备份准备失败，请重试。"));
            }
        });
    }

    private ProjectJob ownedProjectJob(String id) {
        return ProjectBackupPayload.validRequestId(id) && projectJob != null && projectJob.id.equals(id) ? projectJob : null;
    }

    private boolean isCurrentProjectJob(ProjectJob job) {
        return !destroyed && projectJob == job && !job.cancelled.get();
    }

    private void appendProjectChunk(String id, double requestedIndex, String encoded) {
        ProjectJob job = ownedProjectJob(id);
        if (job == null) { notifyProjectTransfer(id, "error", -1, "项目备份请求已失效。"); return; }
        if (!isCurrentProjectJob(job)) return;
        if (job.inFlight || !Double.isFinite(requestedIndex) || requestedIndex != Math.rint(requestedIndex)
                || requestedIndex < 0 || requestedIndex > Integer.MAX_VALUE) { failProjectJob(job, "项目备份分块顺序错误。"); return; }
        final int index = (int) requestedIndex;
        try { ProjectBackupTransfer.validateChunk(encoded); }
        catch (IOException error) { failProjectJob(job, "项目备份分块无效。"); return; }
        job.inFlight = true;
        armProjectTimeout(job);
        fileWorker.execute(() -> {
            try {
                if (job.cancelled.get()) return;
                job.transfer.append(index, encoded);
                runOnUiThread(() -> {
                    if (!isCurrentProjectJob(job)) return;
                    job.inFlight = false;
                    armProjectTimeout(job);
                    notifyProjectTransfer(job.id, "chunk", index, "");
                });
            } catch (IOException | RuntimeException | OutOfMemoryError error) {
                runOnUiThread(() -> failProjectJob(job, "项目备份分块写入失败或顺序错误。"));
            }
        });
    }

    private void completeProjectBackup(String id) {
        ProjectJob job = ownedProjectJob(id);
        if (job == null) { notifyProjectTransfer(id, "error", -1, "项目备份请求已失效。"); return; }
        if (!isCurrentProjectJob(job)) return;
        if (job.inFlight) { failProjectJob(job, "请等待当前项目备份分块完成。"); return; }
        job.inFlight = true;
        armProjectTimeout(job);
        fileWorker.execute(() -> {
            try {
                if (job.cancelled.get()) return;
                File complete = job.transfer.finish();
                if (job.cancelled.get()) { cleanProjectJob(job); return; }
                runOnUiThread(() -> {
                    if (!isCurrentProjectJob(job)) return;
                    clearProjectTimeout();
                    projectJob = null;
                    showSavePicker(complete, job.name, ProjectBackupPayload.MIME);
                    if (pendingExport == complete && exportBusy.get()) notifyProjectTransfer(job.id, "picker", -1, "");
                });
            } catch (IOException | RuntimeException | OutOfMemoryError error) {
                runOnUiThread(() -> failProjectJob(job, "项目备份校验失败，请重新导出。"));
            }
        });
    }

    private void armProjectTimeout(ProjectJob job) {
        clearProjectTimeout();
        projectTimeout = () -> failProjectJob(job, "项目备份传输超时，请重新导出。");
        projectHandler.postDelayed(projectTimeout, PROJECT_TIMEOUT_MS);
    }

    private void clearProjectTimeout() {
        if (projectTimeout != null) projectHandler.removeCallbacks(projectTimeout);
        projectTimeout = null;
    }

    private static void cleanProjectJob(ProjectJob job) {
        if (job.transfer != null) {
            ACTIVE_EXPORT_FILES.remove(job.transfer.file.getName());
            job.transfer.close();
        }
    }

    private void failProjectJob(ProjectJob job, String message) {
        if (projectJob != job) return;
        job.cancelled.set(true);
        projectJob = null;
        clearProjectTimeout();
        // Keep the shared export lock until queued writes and private-cache cleanup finish.
        fileWorker.execute(() -> {
            cleanProjectJob(job);
            runOnUiThread(() -> {
                if (destroyed || !job.id.equals(pendingProjectId)) return;
                notifyProjectTransfer(job.id, "error", -1, message);
                finishExport(false, message);
            });
        });
    }

    private void notifyProjectTransfer(String id, String event, int index, String message) {
        if (!ProjectBackupPayload.validRequestId(id) || destroyed || !ready || webView == null || !isAppDocument(webView.getUrl())) return;
        webView.evaluateJavascript("window.onNativeProjectBackupTransfer && window.onNativeProjectBackupTransfer("
                + JSONObject.quote(id) + "," + JSONObject.quote(event) + "," + index + "," + JSONObject.quote(message) + ");", null);
    }

    private void beginPortrait(String dataUrl, String requestId, String kind) {
        if (!ready || destroyed || webView == null || !isAppDocument(webView.getUrl())) return;
        final long generation = portraitPageGeneration;
        if (!portraitBusy.compareAndSet(false, true)) {
            notifyPortrait(generation, requestId, portraitError("正在分析上一张照片，请稍后重试。"));
            return;
        }
        portraitWorker.execute(() -> {
            JSONObject result;
            try {
                if (portraitAnalyzer == null) portraitAnalyzer = new PortraitAnalyzer(this);
                result = portraitAnalyzer.analyze(dataUrl, kind);
            } catch (IOException error) {
                result = portraitError(error.getMessage());
            } catch (OutOfMemoryError error) {
                result = portraitError("手机可用内存不足，请关闭其他应用或缩小图片后重试。");
            } catch (Exception | LinkageError error) {
                result = portraitError("本机人像分析暂不可用，请重试或使用手动定位。");
            } finally {
                portraitBusy.set(false);
            }
            JSONObject complete = result;
            runOnUiThread(() -> notifyPortrait(generation, requestId, complete));
        });
    }

    private static JSONObject portraitError(String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", false);
            result.put("error", message == null ? "人像分析失败，请重试。" : message);
        } catch (org.json.JSONException ignored) { /* Fixed keys and finite values. */ }
        return result;
    }

    private void notifyPortrait(long generation, String requestId, JSONObject result) {
        if (generation != portraitPageGeneration || !ready || destroyed || webView == null || !isAppDocument(webView.getUrl())) return;
        webView.evaluateJavascript("window.onPortraitAnalysis && window.onPortraitAnalysis("
                + JSONObject.quote(requestId) + "," + result.toString() + ");", null);
    }

    private void beginExport(String dataUrl, String fileName, String mimeType) {
        if (!ready || destroyed || webView == null || !isAppDocument(webView.getUrl())) return;
        if (!exportBusy.compareAndSet(false, true)) {
            // Do not reset the web app's pending state for the original in-flight export.
            Toast.makeText(this, "请先完成当前导出。", Toast.LENGTH_SHORT).show();
            if (EXPORT_PRESET.equals(pendingKind) || EXPORT_PROJECT.equals(pendingKind)) notifyExport(false, "请先完成当前导出。", EXPORT_IMAGE);
            return;
        }
        pendingKind = EXPORT_IMAGE;
        fileWorker.execute(() -> {
            File temp = null;
            try {
                String name = ExportPayload.fileName(fileName, mimeType);
                if (dataUrl == null || dataUrl.length() > ExportPayload.MAX_URL_LENGTH) {
                    throw new IOException("图片过大，请降低导出尺寸。");
                }
                temp = File.createTempFile("mint-export-", ".tmp", getCacheDir());
                ACTIVE_EXPORT_FILES.add(temp.getName());
                try (OutputStream out = new FileOutputStream(temp)) {
                    ExportPayload.decode(dataUrl, mimeType, out);
                }
                File complete = temp;
                runOnUiThread(() -> showSavePicker(complete, name, mimeType));
            } catch (IOException | RuntimeException error) {
                if (temp != null) {
                    ACTIVE_EXPORT_FILES.remove(temp.getName());
                    temp.delete();
                }
                runOnUiThread(() -> finishExport(false, "保存失败：" + readableError(error)));
            } catch (OutOfMemoryError error) {
                if (temp != null) {
                    ACTIVE_EXPORT_FILES.remove(temp.getName());
                    temp.delete();
                }
                runOnUiThread(() -> finishExport(false, "保存失败：可用内存不足，请降低导出尺寸。"));
            }
        });
    }

    private void beginPresetExport(String jsonString, String fileName) {
        if (!ready || destroyed || webView == null || !isAppDocument(webView.getUrl())) return;
        if (!exportBusy.compareAndSet(false, true)) {
            Toast.makeText(this, "请先完成当前导出。", Toast.LENGTH_SHORT).show();
            if (EXPORT_IMAGE.equals(pendingKind) || EXPORT_PROJECT.equals(pendingKind)) notifyExport(false, "请先完成当前导出。", EXPORT_PRESET);
            return;
        }
        pendingKind = EXPORT_PRESET;
        fileWorker.execute(() -> {
            File temp = null;
            try {
                byte[] payload = PresetPayload.validate(jsonString);
                String name = PresetPayload.fileName(fileName);
                temp = File.createTempFile("mint-export-", ".tmp", getCacheDir());
                ACTIVE_EXPORT_FILES.add(temp.getName());
                try (OutputStream out = new FileOutputStream(temp)) { out.write(payload); }
                File complete = temp;
                runOnUiThread(() -> showSavePicker(complete, name, PresetPayload.MIME));
            } catch (IOException | RuntimeException error) {
                if (temp != null) {
                    ACTIVE_EXPORT_FILES.remove(temp.getName());
                    temp.delete();
                }
                runOnUiThread(() -> finishExport(false, "预设保存失败：" + readableError(error)));
            } catch (OutOfMemoryError error) {
                if (temp != null) {
                    ACTIVE_EXPORT_FILES.remove(temp.getName());
                    temp.delete();
                }
                runOnUiThread(() -> finishExport(false, "预设保存失败：可用内存不足，请稍后重试。"));
            }
        });
    }

    private void showSavePicker(File file, String name, String mime) {
        ACTIVE_EXPORT_FILES.remove(file.getName());
        if (destroyed || isFinishing()) {
            file.delete();
            pendingKind = null;
            exportBusy.set(false);
            return;
        }
        pendingExport = file;
        pendingName = name;
        pendingMime = mime;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        if (EXPORT_PROJECT.equals(pendingKind)) intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            startActivityForResult(intent, SAVE_DOCUMENT);
        } catch (ActivityNotFoundException | SecurityException error) {
            finishExport(false, "保存失败：没有可用的系统文件保存应用。");
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_DOCUMENT) {
            ValueCallback<Uri[]> callback = chooserCallback;
            if (callback == null) return;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) {
                cancelChooser();
                return;
            }
            // No direct filesystem paths, file:// URLs, or incoming arbitrary intents.
            if (!"content".equals(uri.getScheme())) {
                cancelChooser();
                Toast.makeText(this, R.string.import_invalid, Toast.LENGTH_LONG).show();
                return;
            }
            try {
                String type = getContentResolver().getType(uri);
                if (type != null) type = type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
                if (chooserKind == ProjectBackupPayload.CHOOSER_PROJECT) {
                    if (!ProjectBackupPayload.isProjectMime(type)) {
                        cancelChooser();
                        Toast.makeText(this, "请选择薄荷 .mintproject 项目备份。", Toast.LENGTH_LONG).show();
                        return;
                    }
                    int generation = chooserGeneration;
                    CancellationSignal cancellation = new CancellationSignal();
                    chooserCancellation = cancellation;
                    projectImportTimeout = () -> {
                        if (chooserCallback != callback || chooserGeneration != generation) return;
                        cancelChooser();
                        Toast.makeText(this, "项目备份读取超时，请选择本机文件后重试。", Toast.LENGTH_LONG).show();
                    };
                    projectHandler.postDelayed(projectImportTimeout, PROJECT_TIMEOUT_MS);
                    presetImportWorker.execute(() -> validateProjectImport(uri, callback, generation, cancellation));
                    return;
                }
                if (chooserKind == PresetPayload.CHOOSER_PRESET) {
                    if (!PresetPayload.isJsonMime(type)) {
                        cancelChooser();
                        Toast.makeText(this, "请选择薄荷 JSON 调整预设，不是照片或其他文件。", Toast.LENGTH_LONG).show();
                        return;
                    }
                    int generation = chooserGeneration;
                    CancellationSignal cancellation = new CancellationSignal();
                    chooserCancellation = cancellation;
                    // Even providers reporting application/json must pass the bounded read
                    // and schema gate. JS checks its second read independently as well.
                    presetImportWorker.execute(() -> validatePresetImport(uri, callback, generation, cancellation));
                    return;
                }
                if (type == null || !type.startsWith("image/") || "image/svg+xml".equals(type)) {
                    cancelChooser();
                    Toast.makeText(this, R.string.import_invalid, Toast.LENGTH_LONG).show();
                    return;
                }
                completeChooser(callback, chooserGeneration, new Uri[]{uri});
            } catch (RuntimeException error) {
                cancelChooser();
                Toast.makeText(this, R.string.import_invalid, Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == SAVE_DOCUMENT) {
            restoredPendingExport = false;
            preservePendingExport = false;
            // Ignore stale results after cancellation or Activity teardown.
            if (!exportBusy.get() || destroyed) return;
            if (resultCode != RESULT_OK) {
                finishExport(false, "已取消保存，编辑内容仍在。");
                return;
            }
            Uri destination = data == null ? null : data.getData();
            File source = pendingExport;
            if (destination == null || !"content".equals(destination.getScheme())
                    || source == null || !source.isFile()) {
                finishExport(false, "保存失败：临时文件已失效，请重新导出。");
                return;
            }
            copyingExport = true;
            ACTIVE_EXPORT_FILES.add(source.getName());
            fileWorker.execute(() -> copyExport(source, destination));
        }
    }

    @SuppressWarnings("try") // Closing here is intentional: Back must interrupt a provider read.
    private void validatePresetImport(Uri uri, ValueCallback<Uri[]> callback, int generation,
                                      CancellationSignal cancellation) {
        boolean valid;
        try (AssetFileDescriptor descriptor = getContentResolver().openAssetFileDescriptor(uri, "r", cancellation)) {
            if (descriptor == null || descriptor.getDeclaredLength() > PresetPayload.MAX_BYTES) throw new IOException();
            try (InputStream in = descriptor.createInputStream()) {
                cancellation.setOnCancelListener(() -> {
                    try { in.close(); } catch (IOException ignored) { /* Already closed or provider unavailable. */ }
                });
                cancellation.throwIfCanceled();
                PresetPayload.read(in);
                cancellation.throwIfCanceled();
            }
            valid = true;
        } catch (IOException | RuntimeException | OutOfMemoryError error) { valid = false; }
        finally { cancellation.setOnCancelListener(null); }
        boolean complete = valid;
        runOnUiThread(() -> {
            if (destroyed || chooserCallback != callback || chooserGeneration != generation) return;
            completeChooser(callback, generation, complete ? new Uri[]{uri} : null);
            if (!complete) Toast.makeText(this,
                    "预设无效：请选择 64 KB 内的第 1 或 2 版薄荷调整预设。", Toast.LENGTH_LONG).show();
        });
    }

    @SuppressWarnings("try") // Closing here is intentional: Back must interrupt a provider read.
    private void validateProjectImport(Uri uri, ValueCallback<Uri[]> callback, int generation,
                                      CancellationSignal cancellation) {
        boolean valid;
        try (AssetFileDescriptor descriptor = getContentResolver().openAssetFileDescriptor(uri, "r", cancellation)) {
            if (descriptor == null || descriptor.getDeclaredLength() > ProjectBackupPayload.MAX_BYTES) throw new IOException();
            try (InputStream in = descriptor.createInputStream()) {
                cancellation.setOnCancelListener(() -> {
                    try { in.close(); } catch (IOException ignored) { /* Already closed or provider unavailable. */ }
                });
                cancellation.throwIfCanceled();
                ProjectBackupPayload.read(in);
                cancellation.throwIfCanceled();
            }
            valid = true;
        } catch (IOException | RuntimeException | OutOfMemoryError error) { valid = false; }
        finally { cancellation.setOnCancelListener(null); }
        boolean complete = valid;
        runOnUiThread(() -> {
            if (destroyed || chooserCallback != callback || chooserGeneration != generation) return;
            completeChooser(callback, generation, complete ? new Uri[]{uri} : null);
            if (!complete) Toast.makeText(this,
                    "项目备份无效：请选择完整且未损坏的 64 MiB 内薄荷项目。", Toast.LENGTH_LONG).show();
        });
    }

    private void completeChooser(ValueCallback<Uri[]> callback, int generation, Uri[] result) {
        if (chooserCallback != callback || chooserGeneration != generation) return;
        chooserCallback = null;
        clearProjectImportTimeout();
        chooserCancellation = null;
        chooserKind = PresetPayload.CHOOSER_INVALID;
        chooserGeneration++;
        callback.onReceiveValue(result);
    }

    private void copyExport(File source, Uri destination) {
        // Revalidate restored project state on the worker before opening the granted target.
        if (EXPORT_PROJECT.equals(pendingKind)) {
            try (InputStream check = new FileInputStream(source)) { ProjectBackupPayload.read(check); }
            catch (IOException | RuntimeException | OutOfMemoryError error) {
                try { DocumentsContract.deleteDocument(getContentResolver(), destination); }
                catch (Exception ignored) { /* Only the new picker-created target. */ }
                runOnUiThread(() -> finishExport(false, "项目备份校验失败，未写入备份内容。"));
                return;
            }
        }
        try (InputStream in = new FileInputStream(source);
             OutputStream out = getContentResolver().openOutputStream(destination, "wt")) {
            if (out == null) throw new IOException("无法写入所选位置。");
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            out.flush();
        } catch (IOException | RuntimeException error) {
            // Only delete the newly-created, incomplete document, never an imported original.
            try { DocumentsContract.deleteDocument(getContentResolver(), destination); }
            catch (Exception ignored) { /* Provider may not support deleting incomplete files. */ }
            runOnUiThread(() -> finishExport(false, "保存失败：" + readableError(error)));
            return;
        }
        runOnUiThread(() -> finishExport(true, "已保存到你选择的位置。"));
    }

    private static String readableError(Exception error) {
        // Do not expose provider paths, image contents, or full low-level exception messages.
        if (error instanceof SecurityException) return "无法访问所选位置，请选择其他文件夹。";
        String message = error.getMessage();
        if (message != null && message.length() < 100 && message.matches(".*[\\u4e00-\\u9fff].*")) {
            return message;
        }
        return "无法写入文件，请检查剩余空间后重试。";
    }

    private void finishExport(boolean success, String message) {
        String kind = pendingKind;
        String projectId = pendingProjectId;
        pendingProjectId = null;
        if (pendingExport != null) {
            ACTIVE_EXPORT_FILES.remove(pendingExport.getName());
            pendingExport.delete();
        }
        pendingExport = null;
        pendingName = null;
        pendingMime = null;
        pendingKind = null;
        copyingExport = false;
        preservePendingExport = false;
        restoredPendingExport = false;
        exportBusy.set(false);
        notifyExport(success, message, kind, projectId);
    }

    private void notifyExport(boolean success, String message, String kind) {
        notifyExport(success, message, kind, null);
    }

    private void notifyExport(boolean success, String message, String kind, String projectId) {
        if (destroyed) return;
        if (!ready || webView == null) {
            queuedExportSuccess = success;
            queuedExportMessage = message;
            queuedExportKind = kind;
            queuedProjectId = projectId;
            return;
        }
        if (!isAppDocument(webView.getUrl())) return;
        if (EXPORT_PROJECT.equals(kind)) {
            if (!ProjectBackupPayload.validRequestId(projectId)) return;
            webView.evaluateJavascript("window.onNativeProjectBackupExportResult && window.onNativeProjectBackupExportResult("
                    + JSONObject.quote(projectId) + "," + success + "," + JSONObject.quote(message) + ");", null);
            return;
        }
        String callback = EXPORT_PRESET.equals(kind) ? "onNativePresetExportResult" : "onNativeExportResult";
        String script = "if(typeof window." + callback + "==='function'){"
                + "window." + callback + "(" + success + "," + JSONObject.quote(message) + ");}";
        webView.evaluateJavascript(script, null);
    }

    private void clearProjectImportTimeout() {
        if (projectImportTimeout != null) projectHandler.removeCallbacks(projectImportTimeout);
        projectImportTimeout = null;
    }

    private void cancelChooser() {
        ValueCallback<Uri[]> callback = chooserCallback;
        chooserCallback = null;
        clearProjectImportTimeout();
        CancellationSignal cancellation = chooserCancellation;
        chooserCancellation = null;
        chooserKind = PresetPayload.CHOOSER_INVALID;
        chooserGeneration++;
        if (cancellation != null) cancellation.cancel();
        if (callback != null) callback.onReceiveValue(null);
    }

    @Override public void onBackPressed() { requestBack(); }

    private void requestBack() {
        if (backRequested || destroyed || (exitDialog != null && exitDialog.isShowing())) return;
        if (exportBusy.get()) {
            Toast.makeText(this, R.string.exit_export_message, Toast.LENGTH_SHORT).show();
            return;
        }
        if (chooserCallback != null) {
            cancelChooser();
            return;
        }
        if (!ready || webView == null) {
            confirmExit();
            return;
        }
        backRequested = true;
        webView.evaluateJavascript("(function(){try{return typeof window.requestClose==='function'"
                + " && window.requestClose()===true;}catch(e){return false;}})()", result -> {
            backRequested = false;
            if (!destroyed && !"true".equals(result)) confirmExit();
        });
    }

    private void confirmExit() {
        if (isFinishing() || destroyed) return;
        exitDialog = new AlertDialog.Builder(this)
                .setTitle(R.string.exit_title).setMessage(R.string.exit_message)
                .setNegativeButton(R.string.exit_cancel, (dialog, which) -> { })
                .setPositiveButton(R.string.exit_confirm, (dialog, which) -> finish())
                .create();
        exitDialog.show();
    }

    private void restorePendingExport(Bundle state) {
        if (state == null) return;
        String name = state.getString(STATE_EXPORT_FILE);
        String mime = state.getString(STATE_EXPORT_MIME);
        String exportName = state.getString(STATE_EXPORT_NAME);
        String kind = state.getString(STATE_EXPORT_KIND, EXPORT_IMAGE);
        String projectId = state.getString(STATE_EXPORT_PROJECT_ID);
        if (EXPORT_PROJECT.equals(kind) && !ProjectBackupPayload.validRequestId(projectId)) return;
        if (state.getBoolean(STATE_PROJECT_STREAMING) && EXPORT_PROJECT.equals(kind)) {
            queuedExportKind = kind;
            queuedProjectId = projectId;
            queuedExportSuccess = false;
            queuedExportMessage = "上次项目备份传输已中断，请重新导出。";
            return;
        }
        if (state.getBoolean(STATE_EXPORT_COPYING) && (EXPORT_IMAGE.equals(kind) || EXPORT_PRESET.equals(kind) || EXPORT_PROJECT.equals(kind))) {
            // The old Activity may still finish a safe write in this process. Do not restore
            // the same operation or delete its source, and never report unconfirmed success.
            queuedExportKind = kind;
            queuedProjectId = projectId;
            queuedExportSuccess = false;
            queuedExportMessage = "上次保存结果尚未确认，请检查所选位置。";
            return;
        }
        if (name == null || !name.matches("mint-export-[A-Za-z0-9-]+\\.tmp")) return;
        File file = new File(getCacheDir(), name);
        try {
            long max;
            if (EXPORT_PRESET.equals(kind) && PresetPayload.MIME.equals(mime)) {
                max = PresetPayload.MAX_BYTES;
                if (exportName == null || !exportName.equals(PresetPayload.fileName(exportName))) return;
                try (InputStream in = new FileInputStream(file)) { PresetPayload.read(in); }
            } else if (EXPORT_PROJECT.equals(kind) && ProjectBackupPayload.MIME.equals(mime)) {
                max = ProjectBackupPayload.MAX_BYTES;
                if (exportName == null || !exportName.equals(ProjectBackupPayload.fileName(exportName))) return;
                // Complete stream and hashes are checked on fileWorker before any target write.
            } else if (EXPORT_IMAGE.equals(kind)) {
                ExportPayload.extension(mime);
                ExportPayload.fileName(exportName, mime);
                max = ExportPayload.MAX_BYTES;
            } else return;
            if (file.isFile() && file.length() > 0 && file.length() <= max) {
                pendingExport = file;
                pendingMime = mime;
                pendingName = exportName;
                pendingKind = kind;
                pendingProjectId = projectId;
                exportBusy.set(true);
                restoredPendingExport = true;
            }
        } catch (IOException ignored) { /* Ignore incomplete state; never restore an arbitrary path. */ }
    }

    private void cleanOldExports() {
        File[] files = getCacheDir().listFiles((directory, name) -> name.startsWith("mint-export-")
                && name.endsWith(".tmp"));
        if (files == null) return;
        for (File file : files) {
            if (!file.equals(pendingExport) && !ACTIVE_EXPORT_FILES.contains(file.getName())) file.delete();
        }
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        if (EXPORT_PROJECT.equals(pendingKind) && pendingProjectId != null) {
            out.putString(STATE_EXPORT_PROJECT_ID, pendingProjectId);
            out.putString(STATE_EXPORT_KIND, pendingKind);
            out.putBoolean(STATE_PROJECT_STREAMING, pendingExport == null);
        }
        if (pendingExport != null) {
            out.putString(STATE_EXPORT_FILE, pendingExport.getName());
            out.putString(STATE_EXPORT_MIME, pendingMime);
            out.putString(STATE_EXPORT_NAME, pendingName);
            out.putString(STATE_EXPORT_KIND, pendingKind);
            out.putBoolean(STATE_EXPORT_COPYING, copyingExport);
            preservePendingExport = !copyingExport;
        }
        super.onSaveInstanceState(out);
    }

    @Override protected void onPause() {
        cancelAi(true);
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override protected void onPostResume() {
        super.onPostResume();
        // Activity results are delivered before resume. If none arrived, the old picker/write
        // was interrupted by process death, and must not leave the new editor permanently busy.
        if (restoredPendingExport) {
            restoredPendingExport = false;
            finishExport(false, "上次保存已中断，请重新导出。");
        }
    }

    @Override protected void onDestroy() {
        destroyed = true;
        cancelAi(false);
        aiWorker.shutdownNow();
        if (unregisterBack != null) unregisterBack.run();
        cancelChooser();
        if (exitDialog != null) exitDialog.dismiss();
        if (webView != null) {
            webView.removeJavascriptInterface("Android");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.destroy();
            webView = null;
        }
        // Mid-stream transport cannot survive a new JS page. Clean it behind any running chunk.
        clearProjectTimeout();
        ProjectJob interrupted = projectJob;
        projectJob = null;
        if (interrupted != null) {
            interrupted.cancelled.set(true);
            fileWorker.execute(() -> cleanProjectJob(interrupted));
        }
        // In-flight writes may finish safely, but cannot update a destroyed Activity.
        fileWorker.shutdown();
        presetImportWorker.shutdownNow();
        // Release native graphs only after an in-flight inference returns, on the same worker.
        portraitWorker.execute(() -> {
            if (portraitAnalyzer != null) portraitAnalyzer.close();
        });
        portraitWorker.shutdown();
        // A pending system picker may survive Activity recreation. A write already running
        // owns its source until completion; a finishing/cancelled picker does not.
        if (pendingExport != null && !copyingExport && (isFinishing() || !preservePendingExport)) {
            pendingExport.delete();
            pendingExport = null;
            pendingKind = null;
            exportBusy.set(false);
        }
        super.onDestroy();
    }

    @android.annotation.TargetApi(33)
    private static final class BackApi33 {
        static Runnable register(Activity activity, Runnable action) {
            android.window.OnBackInvokedCallback callback = action::run;
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            return () -> activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(callback);
        }
    }
}
