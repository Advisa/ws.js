/*jshint laxcomma:true */
var select = require('../../../xpath').SelectNodes
  , Dom = require('xmldom').DOMParser
  , utils = require('../../../utils')
  , consts = require('../../../consts')
  , dateFormat = require('dateformat')
  , SignedXml = require('xml-crypto').SignedXml
  , fs = require('fs');

exports.SecurityClientHandler = SecurityClientHandler;
exports.UsernameToken = UsernameToken;
exports.X509BinarySecurityToken = X509BinarySecurityToken;

var BEGIN_CERT = "-----BEGIN CERTIFICATE-----";
var END_CERT = "-----END CERTIFICATE-----";

function SecurityClientHandler(options, tokens) {
  options = options || {};
  this.options = options;
  this.options.excludeTimestamp = options.excludeTimestamp || false;
  // this.options.responseKeyInfoProvider = options.excludeTimestamp || null;
  this.options.responseKeyInfoProvider = options.responseKeyInfoProvider || null;
  this.options.validateResponseSignature = options.validateResponseSignature || false;

  this.tokens = tokens || [];
  this.id = 0;
}

SecurityClientHandler.prototype.send = function(ctx, callback) {
  var self = this;
  var doc = new Dom().parseFromString(ctx.request);
  this.AddNamespaces(doc);
  var header = select(doc, "/*[local-name(.)='Envelope']/*[local-name(.)='Header']")[0]
  ,  security = utils.appendElement(doc, header, consts.security_ns, "wsse:Security", null);
  if (!this.options.excludeTimestamp) {
    this.AddTimestamp(doc, security);
  }
  for (var i in this.tokens) {
    doc = this.tokens[i].applyMe(doc, this);
  }
  ctx.request = doc.toString();
  this.next.send(ctx, function(err, ctx) {
    self.receive(ctx, callback);
  });
};

SecurityClientHandler.prototype.AddNamespaces = function(doc) {
  doc.firstChild.setAttribute("xmlns:wsu", consts.security_utility_ns);
  doc.firstChild.setAttribute("xmlns:wsse", consts.security_ns);
};

SecurityClientHandler.prototype.AddTimestamp = function(doc, security) {
  var timestamp = utils.appendElement(doc, security, consts.security_utility_ns, "wsu:Timestamp", null)
    , created_time = new Date()
    , expires_time = new Date(created_time.getTime() + 50000);
  // expires_time.setMinutes ( created_time.getMinutes() + expires_timespan );
  var created = utils.appendElement(doc, timestamp, consts.security_utility_ns, "wsu:Created", dateFormat(created_time, "isoUtcDateTime"))
    , expires = utils.appendElement(doc, timestamp, consts.security_utility_ns, "wsu:Expires", dateFormat(expires_time, "isoUtcDateTime"));
};

SecurityClientHandler.prototype.receive = function(ctx, callback) {
  if (this.options.validateResponseSignature) {
    var sig = new SignatureValidator(this.options.responseKeyInfoProvider);

    try {
      sig.validate(ctx.response.toString());
    } catch (err) {
      return callback(err, ctx);
    }
  }

  callback(null, ctx);
};

SecurityClientHandler.prototype.getNextId = function() {
  return "sec_" + this.id++;
};

function SignatureValidator(keyInfoProvider) {
  this.keyInfoProvider = keyInfoProvider;
}

SignatureValidator.prototype.validate = function validate(soap) {
  var doc = new Dom().parseFromString(soap);
  var nodes = select(doc, "//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']");
  if (nodes.length === 0) {
    return;
  }
  var signature = nodes[0];

  var sig = new SignedXml("wssecurity");

  sig.keyInfoProvider = this.keyInfoProvider;
  sig.loadSignature(signature.toString());
  var res = sig.checkSignature(soap);

  if (!res) {
    console.log("signature not valid: " + sig.validationErrors);
    throw "signature not valid: " + sig.validationErrors;
  }
};

/*
function WssKeyInfo(soap) {

  this.soap = soap

  this.getKeyInfo = function(key) {
    return ""
  }

  this.getKey = function(keyInfo) {
    var doc = new Dom().parseFromString(keyInfo)
    var nodes = select(doc, "//@URI")
    if (nodes.length==0)
      throw "could not find key in KeyInfo to use for validation"
    var uri = nodes[0]

    var xpath = "//*['" + uri + "' = @*[local-name(.)='Id' and namespace-uri(.)='http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd']]"
    var nodes = select(doc, xpath)
    if (nodes.length==0)
      throw "can not validate signature: could not find binary security token with id " + uri

    return BEGIN_CERT + nodes[0].data + END_CERT
  }

}
*/

function UsernameToken(options) {
  this.options = options;
}

UsernameToken.prototype.applyMe = function(doc, _security) {
  var security = select(doc, "/*[local-name(.)='Envelope']/*[local-name(.)='Header']/*[local-name(.)='Security']")[0]
    , token = utils.appendElement(doc, security, security.security_ns, "wsse:UsernameToken", null)
    , username = utils.appendElement(doc, token, security.security_ns, "wsse:Username", this.options.username)
    , password = utils.appendElement(doc, token, security.security_ns, "wsse:Password", this.options.password);
  password.setAttribute("Type", "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText");
  return doc;
};


function X509BinarySecurityToken(options) {
  this.options = options;
  if (!this.options.key) {
    throw "Cannot create an X509Token token without specifying a key in the options";
  }
}

X509BinarySecurityToken.prototype.getKey = function() {
  return this.options.key;
};

X509BinarySecurityToken.prototype.getId = function() {
  return this.id;
};

X509BinarySecurityToken.prototype.extractBase64Key = function(key) {
  var start = key.indexOf(BEGIN_CERT) + BEGIN_CERT.length;
  var end = key.indexOf(END_CERT);
  var res = key.substring(start, end);
  res = res.replace(/(\r\n|\n|\r)/gm,"");
  return res;
};

X509BinarySecurityToken.prototype.applyMe = function(doc, _security) {
  this.id = _security.getNextId();
  var base64Key = this.extractBase64Key(this.options.key);
  var security = select(doc, "/*[local-name(.)='Envelope']/*[local-name(.)='Header']/*[local-name(.)='Security']")[0]
    , token = utils.appendElement(doc, security, security.security_ns, "wsse:BinarySecurityToken", base64Key);
  token.setAttribute("ValueType", "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3");
  token.setAttribute("EncodingType", "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary");
  token.setAttribute("wsu:Id", this.id);
  return doc;
};
