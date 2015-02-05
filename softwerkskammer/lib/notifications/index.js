'use strict';

var _ = require('lodash');
var async = require('async');
var conf = require('simple-configure');

var beans = conf.get('beans');
var groupsAndMembers = beans.get('groupsAndMembersService');
var memberstore = beans.get('memberstore');
var Member = beans.get('member');
var transport = beans.get('mailtransport');
var logger = require('winston').loggers.get('transactions');
var jade = require('jade');
var path = require('path');

var defaultRenderingOptions = {
  pretty: true, // makes the generated html nicer, in case someone looks at the mail body
  url: conf.get('publicUrlPrefix')
};

function sendMail(emailAddresses, subject, html, callback) {
  if (!emailAddresses || emailAddresses.length === 0) {
    if (callback) { return callback(null); }
    return;
  }

  var fromName = 'Softwerkskammer Benachrichtigungen';
  var mailoptions = {
    from: '"' + fromName + '" <' + conf.get('sender-address') + '>',
    bcc: _.uniq(emailAddresses).toString(),
    subject: subject,
    html: html,
    generateTextFromHTML: true
  };

  transport.sendMail(mailoptions, function (err) {
    if (callback) { return callback(err); }

    if (err) { return logger.error(err); }
    logger.info('Notification sent. Content: ' + JSON.stringify(mailoptions));
  });
}

function activityParticipation(activity, visitorID, ressourceName, content, type) {
  async.parallel(
    {
      group: function (callback) { groupsAndMembers.getGroupAndMembersForList(activity.assignedGroup(), callback); },
      owner: function (callback) { memberstore.getMemberForId(activity.owner(), callback); },
      visitor: function (callback) { memberstore.getMemberForId(visitorID, callback); }
    },

    function (err, results) {
      if (err) { return logger.error(err); }
      var organizers = _.filter(results.group.members, function (member) { return _.contains(results.group.organizers, member.id()); });
      var organizersEmails = _.map(organizers, function (member) { return member.email(); });
      if (results.owner) {
        organizersEmails.push(results.owner.email());
      }
      if (_.isEmpty(organizersEmails)) { return; }
      var renderingOptions = _.defaults(defaultRenderingOptions, {
        activity: activity,
        ressourceName: ressourceName,
        content: content,
        count: activity.resourceNamed(ressourceName).registeredMembers().length,
        totalcount: activity.allRegisteredMembers().length,
        visitor: results.visitor
      });
      var filename = path.join(__dirname, 'jade/activitytemplate.jade');
      sendMail(organizersEmails, type, jade.renderFile(filename, renderingOptions));
    }
  );
}

module.exports.visitorRegistration = function (activity, visitorID, resourceName) {
  activityParticipation(activity, visitorID, resourceName, 'hat sich ein neuer Besucher angemeldet', 'Neue Anmeldung für Aktivität');
};

module.exports.visitorUnregistration = function (activity, visitorID, resourceName) {
  activityParticipation(activity, visitorID, resourceName, 'hat sich ein Besucher abgemeldet', 'Abmeldung für Aktivität');
};

module.exports.waitinglistAddition = function (activity, visitorID, resourceName) {
  activityParticipation(activity, visitorID, resourceName, 'hat sich jemand auf die Warteliste eingetragen', 'Zugang auf Warteliste');
};

module.exports.waitinglistRemoval = function (activity, visitorID, resourceName) {
  activityParticipation(activity, visitorID, resourceName, 'hat sich jemand von der Warteliste entfernt', 'Streichung aus Warteliste');
};

module.exports.wikiChanges = function (changes, callback) {
  memberstore.allMembers(function (err, members) {
    if (err) { return callback(err); }
    var renderingOptions = _.defaults(defaultRenderingOptions, {
      directories: _.sortBy(changes, 'dir')
    });
    var filename = path.join(__dirname, 'jade/wikichangetemplate.jade');
    var receivers = _.union(Member.superuserEmails(members), Member.wikiNotificationMembers(members));
    sendMail(receivers, 'Wiki Änderungen', jade.renderFile(filename, renderingOptions), callback);
  });
};

module.exports.newMemberRegistered = function (member, subscriptions) {
  memberstore.allMembers(function (err, members) {
    var renderingOptions = _.defaults(defaultRenderingOptions, {
      member: member,
      groups: subscriptions,
      count: members.length
    });
    var filename = path.join(__dirname, 'jade/newmembertemplate.jade');
    var receivers = Member.superuserEmails(members);
    sendMail(receivers, 'Neues Mitglied', jade.renderFile(filename, renderingOptions));
  });
};

module.exports.paymentMarked = function (activity, memberId) {
  memberstore.getMemberForId(memberId, function (err, member) {
    if (err || !member) { return; }
    var renderingOptions = _.defaults(defaultRenderingOptions, {
      member: member,
      activity: activity
    });
    var filename = path.join(__dirname, 'jade/paymenttemplate.jade');
    var receivers = [member.email()];
    sendMail(receivers, 'Payment Receipt / Zahlungseingang', jade.renderFile(filename, renderingOptions));
  });
};

// this is only exported for reuse in socratesNotifications.
module.exports._sendMail = sendMail;
