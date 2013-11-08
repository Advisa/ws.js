
var utils = require('../../utils'),
    request = require('request');

exports.HttpClientHandler = HttpClientHandler;

function HttpClientHandler(options) {
  this.options = options || {};
}

HttpClientHandler.prototype.send = function(ctx, callback) {
  var options = JSON.parse(JSON.stringify(this.options));
  options.url = ctx.url;
  options.body = ctx.request;
  options.headers = {
    "SOAPAction": ctx.action,
    "Content-Type": ctx.contentType || "application/xml+soap",
    "MIME-Version": "1.0"
  };
  options.encoding = null;
  options.rejectUnauthorized = false;

  request.post(options, function (error, response, body) {
    ctx.response = body;
    if (response) {
      ctx.resp_contentType = response.headers["content-type"];
      ctx.statusCode = response.statusCode;
    }
    callback(error, ctx);
  });
};

