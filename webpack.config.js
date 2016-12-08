var ExtractTextPlugin = require("extract-text-webpack-plugin");

module.exports = {
  entry: {
    app: './app/css/app.scss',
  },
  output: {
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
        loader: 'style!css?modules&localIdentName=[local]'
      },
      {
        test: /\.scss$/,
        loader: ExtractTextPlugin.extract('style', 'css?modules&importLoaders=1&localIdentName=[local]!sass'),
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
    new ExtractTextPlugin("css/[name].css")
  ]
};