var ExtractTextPlugin = require("extract-text-webpack-plugin");
var webpack = require("webpack");

module.exports = {
  entry: {
    app: './app/css/app.scss',
    index: './app/js/index.js'
  },
  output: {
    publicPath: '/',
    path: __dirname + '/web',
    filename: "js/[name].js",
  },
  module: {
    loaders: [
      {
        test: /\.woff2?$|\.ttf$|\.eot$|\.svg$/,
        loader: 'file'
      },
      {
        test: /\.css$/,
        loader: 'style-loder!css-loader?modules&localIdentName=[local]'
      },
      {
        test: /\.scss$/,
        loader: ExtractTextPlugin.extract({
          fallbackLoader: 'style-loader',
          loader: 'css-loader?modules&importLoaders=1&localIdentName=[local]!sass-loader'
        }),
        exclude: /node_modules|lib/,
      },
      {
        test: /\.json$/,
        loader: "json-loader"
      },
      {
        test: /\.jsx?/,
        include: __dirname + '/js',
        loader: "babel-loader"
      }
    ]
  },
  plugins: [
    new ExtractTextPlugin("css/[name].css"),
    new webpack.ProvidePlugin({
      $: "jquery",
      jQuery: "jquery"
    })
  ],
  devServer: {
    port: 9091,
    contentBase: __dirname + '/web',
    stats: 'minimal',
    compress: true
  }
};