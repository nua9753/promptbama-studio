/* PromptBama Studio — admin helpers (color picker, connection test). */
(function ($) {
  'use strict';
  $(function () {
    $('.pbs-color').wpColorPicker();

    $('#pbs-test').on('click', function () {
      var $out = $('#pbs-test-result');
      $out.removeClass('is-ok is-fail').text(PBS_ADMIN.i18n.testing);
      $.post(PBS_ADMIN.ajaxUrl, { action: 'pbs_test', _ajax_nonce: PBS_ADMIN.nonce })
        .done(function (res) {
          if (res && res.success) {
            var d = res.data || {};
            var s = d.services || {};
            var parts = [PBS_ADMIN.i18n.ok + (d.site ? ' — ' + d.site : '')];
            parts.push('پرداخت: ' + (s.payments ? '✓' : '✗'));
            parts.push('ذخیره‌سازی: ' + (s.storage ? '✓' : '✗'));
            parts.push('ثبت‌نام: ' + (s.signup ? '✓' : '✗'));
            if (!d.originMatches) {
              parts.push('هشدار: دامنه‌ی ' + d.homeOrigin + ' در فهرست دامنه‌های مجاز این کلید نیست.');
            }
            $out.addClass(d.originMatches ? 'is-ok' : 'is-fail').text(parts.join(' · '));
          } else {
            var msg = res && res.data && res.data.message ? res.data.message : '';
            $out.addClass('is-fail').text(PBS_ADMIN.i18n.fail + (msg ? ': ' + msg : ''));
          }
        })
        .fail(function () {
          $out.addClass('is-fail').text(PBS_ADMIN.i18n.fail);
        });
    });
  });
})(jQuery);
