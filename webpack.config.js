const { resolve } = require('path');
var glob = require('glob');
var path = require('path');

const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ESBuildMinifyPlugin } = require('esbuild-loader');
const { ProvidePlugin, BannerPlugin } = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');

const CopyPlugin = require('copy-webpack-plugin');

const isProd = process.env.NODE_ENV === 'production';
const isDevelopment = !isProd;

const fastRefresh = isDevelopment ? new ReactRefreshWebpackPlugin() : null;

const SANDBOX_SUFFIX = '-sandbox';

const config = {
  mode: isProd ? 'production' : 'development',
  entry: glob.sync('./src/widgets/**/*.tsx').reduce((obj, el) => {
    const rel = path
      .relative('src/widgets', el)
      .replace(/\.[tj]sx?$/, '')
      .replace(/\\/g, '/');

    obj[rel] = el;
    obj[`${rel}${SANDBOX_SUFFIX}`] = el;
    return obj;
  }, {}),

  output: {
    path: resolve(__dirname, 'dist'),
    filename: `[name].js`,
    publicPath: '',
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx|jsx|js)?$/,
        loader: 'esbuild-loader',
        options: {
          loader: 'tsx',
          target: 'es2020',
          minify: false,
        },
      },
      {
        test: /\.css$/i,
        use: [
          isDevelopment ? 'style-loader' : MiniCssExtractPlugin.loader,
          { loader: 'css-loader', options: { url: false } },
          'postcss-loader',
        ],
      },
    ],
  },
  plugins: [
    isDevelopment
      ? undefined
      : new MiniCssExtractPlugin({
          filename: '[name].css',
        }),
    new HtmlWebpackPlugin({
      templateContent: `
      <body></body>
      <script type="text/javascript">
      const urlSearchParams = new URLSearchParams(window.location.search);
      const queryParams = Object.fromEntries(urlSearchParams.entries());
      const widgetName = queryParams["widgetName"];
      if (widgetName == undefined) {document.body.innerHTML+="Widget ID not specified."}

      const s = document.createElement('script');
      s.type = "module";
      s.src = widgetName+"${SANDBOX_SUFFIX}.js";
      document.body.appendChild(s);
      </script>
    `,
      filename: 'index.html',
      inject: false,
    }),
    new ProvidePlugin({
      React: 'react',
      reactDOM: 'react-dom',
    }),
    new BannerPlugin({
      banner: (file) => {
        return !file.chunk.name.includes(SANDBOX_SUFFIX) ? 'const IMPORT_META=import.meta;' : '';
      },
      raw: true,
    }),
    new CopyPlugin({
      patterns: [
        { from: 'public', to: '' },
        { from: 'README.md', to: '' },
      ],
    }),
    fastRefresh,
  ].filter(Boolean),
};

if (isProd) {
  config.optimization = {
    minimize: isProd,
    minimizer: [new ESBuildMinifyPlugin()],
  };
} else {
  // for more information, see https://webpack.js.org/configuration/dev-server
  config.devServer = {
    port: 8080,
    host: '0.0.0.0',
    allowedHosts: 'all',
    open: false,
    hot: true,
    compress: true,
    watchFiles: ['src/*'],
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Private-Network': 'true',
    },
    setupMiddlewares: (middlewares, devServer) => {
      const fs = require('fs');
      const path = require('path');

      devServer.app.use((req, res, next) => {
        const origin = req.headers.origin || '*';
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
          return;
        }
        next();
      });

      devServer.app.get('/manifest.json', (req, res) => {
        const origin = req.headers.origin || '*';
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const manifestPath = path.resolve(__dirname, 'public/manifest.json');
        res.send(fs.readFileSync(manifestPath, 'utf8'));
      });

      return middlewares;
    },
  };
}

module.exports = config;
