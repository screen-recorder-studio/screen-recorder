// 🔄 Mediabunny 加载器
// 专门用于加载和初始化 Mediabunny 库

class MediabunnyLoader {
    constructor() {
        this.isLoaded = false;
        this.isLoading = false;
        this.loadPromise = null;
        this.mediabunny = null;
    }

    async load() {
        // 如果已经加载，直接返回
        if (this.isLoaded) {
            return this.mediabunny;
        }

        // 如果正在加载，等待加载完成
        if (this.isLoading) {
            return this.loadPromise;
        }

        this.isLoading = true;
        console.log('🔄 开始加载 Mediabunny 库...');

        this.loadPromise = this._loadMediabunny();
        
        try {
            this.mediabunny = await this.loadPromise;
            this.isLoaded = true;
            console.log('✅ Mediabunny 库加载成功');
            
            // 设置全局变量
            window.Mediabunny = this.mediabunny;
            
            // 触发加载完成事件
            window.dispatchEvent(new CustomEvent('mediabunnyLoaded', {
                detail: { Mediabunny: this.mediabunny }
            }));
            
            return this.mediabunny;
        } catch (error) {
            console.error('❌ Mediabunny 库加载失败:', error);
            
            // 触发加载错误事件
            window.dispatchEvent(new CustomEvent('mediabunnyLoadError', {
                detail: { error }
            }));
            
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    async _loadMediabunny() {
        try {
            // 方法1: 尝试动态导入
            console.log('🔄 尝试方法1: 动态导入...');

            // 获取当前脚本的基础路径
            const currentScript = document.currentScript || document.querySelector('script[src*="mediabunny-loader"]');
            const basePath = currentScript ? currentScript.src.replace(/\/[^\/]*$/, '/') : '';
            const mediabunnyPath = basePath + 'libs/mediabunny.js';

            console.log('MediaBunny 路径:', mediabunnyPath);

            const MediabunnyModule = await import(mediabunnyPath);
            
            // 创建 Mediabunny 对象
            const mediabunny = {
                // 核心类
                Input: MediabunnyModule.Input,
                Output: MediabunnyModule.Output,
                Conversion: MediabunnyModule.Conversion,
                
                // 源和目标
                BlobSource: MediabunnyModule.BlobSource,
                BufferTarget: MediabunnyModule.BufferTarget,
                CanvasSource: MediabunnyModule.CanvasSource,
                
                // 格式
                Mp4OutputFormat: MediabunnyModule.Mp4OutputFormat,
                
                // 常量
                ALL_FORMATS: MediabunnyModule.ALL_FORMATS,
                VIDEO_CODECS: MediabunnyModule.VIDEO_CODECS,
                AUDIO_CODECS: MediabunnyModule.AUDIO_CODECS,
                
                // 质量设置
                QUALITY_LOW: MediabunnyModule.QUALITY_LOW,
                QUALITY_MEDIUM: MediabunnyModule.QUALITY_MEDIUM,
                QUALITY_HIGH: MediabunnyModule.QUALITY_HIGH,
                QUALITY_VERY_HIGH: MediabunnyModule.QUALITY_VERY_HIGH,
                
                // 其他所有导出
                ...MediabunnyModule
            };
            
            // 验证关键类是否存在
            const requiredClasses = ['Input', 'Output', 'Conversion', 'BlobSource', 'Mp4OutputFormat', 'BufferTarget', 'CanvasSource'];
            const missingClasses = requiredClasses.filter(className => !mediabunny[className]);
            
            if (missingClasses.length > 0) {
                throw new Error(`缺少必需的类: ${missingClasses.join(', ')}`);
            }
            
            console.log('✅ 动态导入成功，所有必需类都可用');
            return mediabunny;
            
        } catch (importError) {
            console.warn('⚠️ 动态导入失败，尝试备用方案:', importError.message);
            
            // 方法2: 备用方案 - 作为普通脚本加载
            return this._loadAsScript();
        }
    }

    async _loadAsScript() {
        return new Promise((resolve, reject) => {
            console.log('🔄 尝试方法2: 作为普通脚本加载...');
            
            const script = document.createElement('script');
            script.src = './libs/mediabunny.js';
            script.type = 'module';
            
            script.onload = () => {
                console.log('✅ 脚本加载成功');
                
                // 检查全局变量
                if (typeof window.Mediabunny !== 'undefined') {
                    console.log('✅ 全局 Mediabunny 对象可用');
                    resolve(window.Mediabunny);
                } else {
                    // 如果全局变量不存在，尝试从模块中获取
                    setTimeout(() => {
                        if (typeof window.Mediabunny !== 'undefined') {
                            resolve(window.Mediabunny);
                        } else {
                            reject(new Error('脚本加载成功但全局 Mediabunny 对象不可用'));
                        }
                    }, 1000);
                }
            };
            
            script.onerror = (error) => {
                console.error('❌ 脚本加载失败:', error);
                reject(new Error('脚本加载失败'));
            };
            
            document.head.appendChild(script);
        });
    }

    // 等待 Mediabunny 加载完成
    async waitForLoad(timeout = 10000) {
        if (this.isLoaded) {
            return this.mediabunny;
        }

        return new Promise((resolve, reject) => {
            const onLoaded = (event) => {
                window.removeEventListener('mediabunnyLoaded', onLoaded);
                window.removeEventListener('mediabunnyLoadError', onError);
                clearTimeout(timeoutId);
                resolve(event.detail.Mediabunny);
            };

            const onError = (event) => {
                window.removeEventListener('mediabunnyLoaded', onLoaded);
                window.removeEventListener('mediabunnyLoadError', onError);
                clearTimeout(timeoutId);
                reject(event.detail.error);
            };

            window.addEventListener('mediabunnyLoaded', onLoaded);
            window.addEventListener('mediabunnyLoadError', onError);

            const timeoutId = setTimeout(() => {
                window.removeEventListener('mediabunnyLoaded', onLoaded);
                window.removeEventListener('mediabunnyLoadError', onError);
                reject(new Error('等待 Mediabunny 加载超时'));
            }, timeout);

            // 如果还没开始加载，启动加载
            if (!this.isLoading && !this.isLoaded) {
                this.load().catch(() => {
                    // 错误已经通过事件处理
                });
            }
        });
    }

    // 检查是否支持
    isSupported() {
        if (!this.isLoaded || !this.mediabunny) {
            return false;
        }

        try {
            // 检查关键类
            const requiredClasses = ['Input', 'Output', 'Conversion', 'BlobSource', 'Mp4OutputFormat', 'BufferTarget'];
            return requiredClasses.every(className => typeof this.mediabunny[className] === 'function');
        } catch (error) {
            console.error('❌ 支持检查失败:', error);
            return false;
        }
    }
}

// 创建全局加载器实例
window.mediabunnyLoader = new MediabunnyLoader();

// 自动开始加载
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.mediabunnyLoader.load();
    });
} else {
    // 如果文档已经加载完成，立即开始加载
    setTimeout(() => {
        window.mediabunnyLoader.load();
    }, 100);
}

console.log('📦 Mediabunny 加载器已初始化');
