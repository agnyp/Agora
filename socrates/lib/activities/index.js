'use strict';

var async = require('async');
var _ = require('lodash');
var moment = require('moment-timezone');

var beans = require('simple-configure').get('beans');
var misc = beans.get('misc');
var CONFLICTING_VERSIONS = beans.get('constants').CONFLICTING_VERSIONS;
var activitiesService = beans.get('activitiesService');
var socratesActivitiesService = beans.get('socratesActivitiesService');
var activitystore = beans.get('activitystore');

var Activity = beans.get('activity');
var eventstoreService = beans.get('eventstoreService');
var eventstore = beans.get('eventstore');
var validation = beans.get('validation');
var statusmessage = beans.get('statusmessage');
var roomOptions = beans.get('roomOptions');

var currentUrl = beans.get('socratesConstants').currentUrl;

var reservedURLs = '^new$|^edit$|^submit$|^checkurl$\\+';

var app = misc.expressAppIn(__dirname);

function activitySubmitted(req, res, next) {
  eventstoreService.getSoCraTesCommandProcessor(req.body.previousUrl, function (err, socratesCommandProcessor) {
    if (err) { return next(err); }
    socratesCommandProcessor.updateFromUI(req.body);
    eventstore.saveEventStore(socratesCommandProcessor.eventStore(), function (err1) {
      if (err1 && err1.message === CONFLICTING_VERSIONS) {
        // we try again because of a racing condition during save:
        statusmessage.errorMessage('message.title.conflict', 'message.content.save_error_retry').putIntoSession(req);
        return res.redirect('/activities/edit/' + encodeURIComponent(req.body.previousUrl));
      }
      if (err1) { return next(err1); }

      // update the activity because we need it for the display in the SWK calendar
      // TODO SWK must not create activities whose URLs start with 'socrates-'!
      activitiesService.getActivityWithGroupAndParticipants(req.body.previousUrl, function (err2, activity) {
        if (err2) { return next(err2); }
        if (!activity) { activity = new Activity({owner: req.user.member.id()}); }
        req.body.isSoCraTes = true; // mark activity as SoCraTes activity (important for SWK)
        activity.fillFromUI(req.body);
        activitystore.saveActivity(activity, function (err3) {
          if (err3 && err3.message === CONFLICTING_VERSIONS) {
            // we try again because of a racing condition during save:
            statusmessage.errorMessage('message.title.conflict', 'message.content.save_error_retry').putIntoSession(req);
            return res.redirect('/activities/edit/' + encodeURIComponent(activity.url()));
          }
          if (err3) { return next(err3); }
          statusmessage.successMessage('message.title.save_successful', 'message.content.activities.saved').putIntoSession(req);
          res.redirect('/registration/');
        });
      });
    });
  });
}

app.get('/new', function (req, res) {
  res.render('edit', {socratesReadModel: eventstoreService.newSoCraTesReadModel(), roomTypes: roomOptions.allIds()});
});

app.get('/edit/:url', function (req, res, next) {
  eventstoreService.getSoCraTesReadModel(req.params.url, function (err, socratesReadModel) {
    if (err || socratesReadModel === null) { return next(err); }
    if (!res.locals.accessrights.canEditActivity()) {
      return res.redirect('/registration/');
    }
    res.render('edit', {socratesReadModel: socratesReadModel, roomTypes: roomOptions.allIds()});
  });
});

app.post('/submit', function (req, res, next) {
  var year = req.body.startDate.split('/')[2];
  req.body.title = 'SoCraTes ' + year;
  req.body.url = 'socrates-' + year;
  req.body.location = 'Soltau, Germany'; // important because it shows up in the iCal data :-)
  req.body.assignedGroup = 'G'; // required by SWK code

  async.parallel(
    [
      function (callback) {
        // we need this helper function (in order to have a closure?!)
        var validityChecker = function (url, cb) { eventstoreService.isValidUrl(url, cb); };
        validation.checkValidity(req.body.previousUrl.trim(), req.body.url.trim(), validityChecker, req.i18n.t('validation.url_not_available'), callback);
      },
      function (callback) {
        var errors = validation.isValidForActivity(req.body);
        return callback(null, errors);
      }
    ],
    function (err, errorMessages) {
      if (err) { return next(err); }
      var realErrors = _.filter(_.flatten(errorMessages), function (message) { return !!message; });
      if (realErrors.length === 0) {
        return activitySubmitted(req, res, next);
      }
      return res.render('../../../views/errorPages/validationError', {errors: realErrors});
    }
  );
});

app.get('/checkurl', function (req, res) {
  misc.validate(req.query.url, req.query.previousUrl, _.partial(activitiesService.isValidUrl, reservedURLs), res.end);
});

// for management tables:

app.get('/paymentReceived/:nickname', function (req, res) {
  socratesActivitiesService.submitPaymentReceived(req.params.nickname, function (err) {
    if (err) { return res.send('Error: ' + err); }
    res.send(moment().locale('de').format('L'));
  });
});

app.get('/fromWaitinglistToParticipant/:resourceName/:nickname', function (req, res) {
  var registrationTuple = {
    activityUrl: currentUrl,
    resourceName: req.params.resourceName,
    duration: 2,
    sessionID: req.sessionID
  };

  socratesActivitiesService.fromWaitinglistToParticipant(req.params.nickname, registrationTuple, function (err) {
    if (err) { return res.send('Error: ' + err); }
    res.send('-> Teilnehmer');
  });
});

app.post('/newDuration', function (req, res, next) {
  socratesActivitiesService.newDurationFor(req.body.nickname, req.body.resourceName, req.body.duration, function (err) {
    if (err) {return next(err); }
    res.redirect('/registration/management');
  });
});

app.post('/newResource', function (req, res, next) {
  socratesActivitiesService.newResourceFor(req.body.nickname, req.body.resourceName, req.body.newResourceName, function (err) {
    if (err) {return next(err); }
    res.redirect('/registration/management');
  });
});

app.post('/newWaitinglist', function (req, res, next) {
  socratesActivitiesService.newWaitinglistFor(req.body.nickname, req.body.resourceName, req.body.newResourceName, function (err) {
    if (err) {return next(err); }
    res.redirect('/registration/management');
  });
});

app.post('/newParticipantPair', function (req, res, next) {
  socratesActivitiesService.newParticipantPairFor(req.body.resourceName, req.body.participant1, req.body.participant2, function (err) {
    if (err) { return next(err); }
    res.redirect('/registration/management');
  });
});

app.post('/removeParticipantPair', function (req, res, next) {
  socratesActivitiesService.removeParticipantPairFor(req.body.resourceName, req.body.participant1, req.body.participant2, function (err) {
    if (err) { return next(err); }
    res.redirect('/registration/management');
  });
});

app.post('/removeParticipant', function (req, res, next) {
  socratesActivitiesService.removeParticipantFor(req.body.resourceName, req.body.participant, function (err) {
    if (err) { return next(err); }
    res.redirect('/registration/management');
  });
});

app.post('/removeWaitinglistMember', function (req, res, next) {
  socratesActivitiesService.removeWaitinglistMemberFor(req.body.resourceName, req.body.waitinglistMember, function (err) {
    if (err) { return next(err); }
    res.redirect('/registration/management');
  });
});

module.exports = app;
