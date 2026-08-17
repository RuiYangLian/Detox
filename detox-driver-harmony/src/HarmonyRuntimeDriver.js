const path = require('path');

const EspressoDetoxApi = require('detox/src/android/espressoapi/EspressoDetox');
const UiDeviceProxy = require('detox/src/android/espressoapi/UiDeviceProxy');
const temporaryPath = require('detox/src/artifacts/utils/temporaryPath');
const getAbsoluteBinaryPath = require('detox/src/utils/getAbsoluteBinaryPath');
const logger = require('detox/src/utils/logger');
const DeviceDriverBase = require('detox/src/devices/runtime/drivers/DeviceDriverBase');

const HDC = require('./HDC');

const log = logger.child({ cat: 'device' });

class HarmonyRuntimeDriver extends DeviceDriverBase {
  constructor(deps, deviceCookie) {
    super(deps);
    this.hdcName = deviceCookie.hdcName;
    this.hdc = new HDC();
    this.invocationManager = deps.invocationManager;
    this.client = deps.client;
    this._launched = false;
    this._rportPort = null;

    this.uiDevice = new UiDeviceProxy(this.invocationManager).getUIDevice();
  }

  getExternalId() {
    return this.hdcName;
  }

  getDeviceName() {
    return this.hdcName;
  }

  declareArtifactPlugins() {
    return super.declareArtifactPlugins();
  }

  async getBundleIdFromBinary() {
    throw new Error('HarmonyOS bundleId must be set in detox config (apps.*.bundleId)');
  }

  async installApp(binaryPath, testBinaryPath) {
    const hap = getAbsoluteBinaryPath(binaryPath);
    log.debug({ event: 'HARMONY_INSTALL' }, `installing main HAP: ${hap}`);
    await this.hdc.install(this.hdcName, hap);

    if (testBinaryPath) {
      const testHap = getAbsoluteBinaryPath(testBinaryPath);
      log.debug({ event: 'HARMONY_INSTALL' }, `installing test HAP: ${testHap}`);
      await this.hdc.install(this.hdcName, testHap);
    }
  }

  async uninstallApp(bundleId) {
    log.debug({ event: 'HARMONY_UNINSTALL' }, `uninstalling ${bundleId}`);
    await this.hdc.uninstall(this.hdcName, bundleId);
  }

  async _reverseServerPort() {
    const serverUrl = this.client.serverUrl;
    const serverPort = new URL(serverUrl).port;
    log.info({ event: 'HARMONY_RPORT_SETUP' }, `rport ${serverPort} for ${this.hdcName}`);
    await this.hdc.rport(this.hdcName, serverPort, serverPort);
    log.debug({ event: 'HARMONY_RPORT' }, `rport tcp:${serverPort} �?tcp:${serverPort}`);
    return serverPort;
  }

  async launchApp(bundleId, launchArgs = {}) {
    if (!this._rportPort) {
      this._rportPort = await this._reverseServerPort();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const serverPort = this._rportPort;

    const newInstance = launchArgs.newInstance === true || (launchArgs.detoxServerUrl === undefined && !this._launched);
    if (this._launched && !newInstance) {
      return NaN;
    }

    if (this._launched) {
      await this.hdc.stopAbility(this.hdcName, bundleId);
      try {
        const pidOut = await this.hdc.shell(this.hdcName, `pidof ${bundleId}`);
        const pids = pidOut.trim().split(/\s+/).filter(Boolean);
        log.info({ event: 'HARMONY_KILL' }, `pidof ${bundleId} �?[${pids.join(', ')}]`);
        for (const pid of pids) {
          if (/^\d+$/.test(pid)) {
            await this.hdc.shell(this.hdcName, `kill -9 ${pid}`);
          }
        }
      } catch (_e) { /* best-effort */ }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const detoxServer = `ws://localhost:${serverPort}`;

    const testParams = [];
    testParams.push(['DetoxServer', detoxServer]);
    if (launchArgs.detoxSessionId) {
      testParams.push(['DetoxSessionId', String(launchArgs.detoxSessionId)]);
    }

    for (const [key, value] of Object.entries(launchArgs)) {
      if (key === 'detoxServerUrl' || key === 'detoxServer' || key === 'detoxSessionId' || key === 'entryAbility' || key === 'newInstance') continue;
      testParams.push([key, String(value)]);
    }

    const moduleName = launchArgs.testModuleName || 'entry_test';
    const testRunner = launchArgs.testRunner || 'OpenHarmonyTestRunner';
    const waitSeconds = launchArgs.testTimeout || 300;

    log.info({ event: 'HARMONY_AA_TEST' }, `aa test: bundle=${bundleId} module=${moduleName} params=${JSON.stringify(testParams)}`);
    this.hdc.startTestAbility(
      this.hdcName, bundleId, moduleName, testRunner, testParams, waitSeconds
    ).catch((err) => {
      log.error({ event: 'HARMONY_LAUNCH_ERROR' }, `aa test failed: ${err.message}`);
    });

    this._launched = true;
    return NaN;
  }

  async waitForAppLaunch() {
    return NaN;
  }

  async terminateApp(bundleId) {
    await this.hdc.stopAbility(this.hdcName, bundleId);
  }

  async takeScreenshot(screenshotName) {
    const localPath = temporaryPath.for.png(screenshotName);
    const remotePath = `/data/local/tmp/${path.basename(localPath)}`;
    await this.hdc.shell(this.hdcName, `snapshot_display -f ${remotePath}`);
    await this.hdc.getFile(this.hdcName, remotePath, localPath);
    return localPath;
  }

  async pressBack() {
    await this.hdc.shell(this.hdcName, 'uitest uiInput keyEvent Back');
  }

  async sendToHome() {
    await this.hdc.shell(this.hdcName, 'uitest uiInput keyEvent Home');
  }

  getPlatform() {
    return 'harmony';
  }

  async setOrientation(orientation) {
    const code = orientation === 'landscape' ? 1 : 0;
    await this.invocationManager.execute(EspressoDetoxApi.changeOrientation(code));
  }

  async resetAppState() {
  }

  async shutdown() {
  }
}

module.exports = HarmonyRuntimeDriver;
