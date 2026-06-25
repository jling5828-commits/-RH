const path = require("path");
const fs = require("fs");
const CleanWebpackPluginModule = require("clean-webpack-plugin");
const CleanWebpackPlugin = CleanWebpackPluginModule.CleanWebpackPlugin || CleanWebpackPluginModule;

const modeIndex = process.argv.indexOf("--mode");
const cliMode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] || (modeIndex >= 0 ? process.argv[modeIndex + 1] : "");
const isProduction = process.env.NODE_ENV === "production" || cliMode === "production";
const devtool = isProduction ? false : "source-map";

const commonRules = [
    {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        loader: "babel-loader",
        options: {
            plugins: [
                "@babel/transform-react-jsx",
                "@babel/proposal-object-rest-spread",
                "@babel/plugin-syntax-class-properties",
            ],
        },
    },
    {
        test: /\.png$/,
        exclude: /node_modules/,
        loader: "file-loader",
    },
    {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
    },
];

class CopyPluginAssets {
    constructor({ from, to = "." }) {
        this.from = from;
        this.to = to;
    }

    apply(compiler) {
        const pluginName = "CopyPluginAssets";
        compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
            const { RawSource } = compiler.webpack.sources;
            compilation.hooks.processAssets.tapPromise(
                {
                    name: pluginName,
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
                },
                async () => {
                    const fromAbs = path.resolve(__dirname, this.from);
                    const toPrefix = this.to === "." ? "" : this.to.replace(/\\/g, "/").replace(/\/+$/, "");
                    const files = [];
                    const walk = (dir) => {
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            const fullPath = path.join(dir, entry.name);
                            if (entry.isDirectory()) walk(fullPath);
                            else if (entry.isFile()) files.push(fullPath);
                        }
                    };
                    walk(fromAbs);
                    for (const file of files) {
                        const rel = path.relative(fromAbs, file).replace(/\\/g, "/");
                        const target = toPrefix ? `${toPrefix}/${rel}` : rel;
                        compilation.emitAsset(target, new RawSource(fs.readFileSync(file)));
                    }
                }
            );
        });
    }
}

const hostConfig = {
    name: "host",
    entry: "./plugin/host/index.jsx",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "host.js",
    },
    devtool,
    externals: {
        uxp: "commonjs2 uxp",
        photoshop: "commonjs2 photoshop",
        os: "commonjs2 os",
    },
    resolve: { extensions: [".js", ".jsx"] },
    module: { rules: commonRules },
    plugins: [
        new CleanWebpackPlugin({
            cleanOnceBeforeBuildPatterns: ["**/*"],
            cleanStaleWebpackAssets: true,
        }),
        new CopyPluginAssets({ from: "plugin", to: "." }),
    ],
};

const appConfig = {
    name: "app",
    entry: "./src/appWebView.jsx",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "app.js",
    },
    devtool,
    resolve: {
        extensions: [".js", ".jsx"],
        alias: {
            uxp: path.resolve(__dirname, "src/bridge/uxpShim.js"),
            photoshop: path.resolve(__dirname, "src/bridge/photoshopShim.js"),
        },
    },
    module: { rules: commonRules },
    plugins: [new CopyPluginAssets({ from: "plugin", to: "." })],
};

module.exports = [hostConfig, appConfig];
