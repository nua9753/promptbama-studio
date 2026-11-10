<?php
/**
 * WordPress admin panel: dashboard (A/B funnel + PromptBama stats), connection,
 * design, texts, placement and category mapping.
 *
 * @package PromptBamaStudio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PBS_Admin {

	const SLUG = 'promptbama-studio';
	const CAP  = 'manage_options';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'admin_post_pbs_save', array( __CLASS__, 'save' ) );
		add_action( 'admin_post_pbs_reset_stats', array( __CLASS__, 'reset_stats' ) );
		add_action( 'wp_ajax_pbs_test', array( __CLASS__, 'ajax_test' ) );
		add_action( 'admin_notices', array( __CLASS__, 'setup_notice' ) );
	}

	public static function tabs() {
		return array(
			'dashboard'  => __( 'داشبورد', 'promptbama-studio' ),
			'connection' => __( 'اتصال', 'promptbama-studio' ),
			'design'     => __( 'طرح و رنگ', 'promptbama-studio' ),
			'texts'      => __( 'متن‌ها', 'promptbama-studio' ),
			'placement'  => __( 'محل نمایش', 'promptbama-studio' ),
			'mapping'    => __( 'نگاشت دسته‌ها', 'promptbama-studio' ),
		);
	}

	public static function menu() {
		add_menu_page(
			__( 'استودیو پرامپت باما', 'promptbama-studio' ),
			__( 'پرامپت باما', 'promptbama-studio' ),
			self::CAP,
			self::SLUG,
			array( __CLASS__, 'render' ),
			'dashicons-format-image',
			58
		);
	}

	public static function assets( $hook ) {
		if ( 'toplevel_page_' . self::SLUG !== $hook ) {
			return;
		}
		wp_enqueue_style( 'wp-color-picker' );
		wp_enqueue_style( 'pbs-admin', PBS_URL . 'assets/admin.css', array(), PBS_VERSION );
		wp_enqueue_script( 'pbs-admin', PBS_URL . 'assets/admin.js', array( 'jquery', 'wp-color-picker' ), PBS_VERSION, true );
		wp_localize_script(
			'pbs-admin',
			'PBS_ADMIN',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( 'pbs_test' ),
				'i18n'    => array(
					'testing' => __( 'در حال بررسی…', 'promptbama-studio' ),
					'ok'      => __( 'اتصال برقرار است', 'promptbama-studio' ),
					'fail'    => __( 'اتصال برقرار نشد', 'promptbama-studio' ),
				),
			)
		);
	}

	public static function setup_notice() {
		if ( ! current_user_can( self::CAP ) || PBS_Options::is_ready() ) {
			return;
		}
		$screen = get_current_screen();
		if ( $screen && 'toplevel_page_' . self::SLUG === $screen->id ) {
			return;
		}
		printf(
			'<div class="notice notice-info"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'استودیو پرامپت باما هنوز فعال نیست.', 'promptbama-studio' ),
			esc_url( admin_url( 'admin.php?page=' . self::SLUG . '&tab=connection' ) ),
			esc_html__( 'تنظیم اتصال', 'promptbama-studio' )
		);
	}

	/* ------------------------------ actions ------------------------------ */

	public static function save() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'دسترسی ندارید.', 'promptbama-studio' ) );
		}
		check_admin_referer( 'pbs_save' );
		$tab = isset( $_POST['pbs_tab'] ) ? sanitize_key( wp_unslash( $_POST['pbs_tab'] ) ) : 'connection';
		if ( ! array_key_exists( $tab, self::tabs() ) ) {
			$tab = 'connection';
		}
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised per field in PBS_Options.
		$input = isset( $_POST['pbs'] ) ? (array) $_POST['pbs'] : array();
		PBS_Options::sanitize_tab( $input, $tab );
		delete_transient( 'pbs_remote_stats' );
		wp_safe_redirect( admin_url( 'admin.php?page=' . self::SLUG . '&tab=' . $tab . '&saved=1' ) );
		exit;
	}

	public static function reset_stats() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'دسترسی ندارید.', 'promptbama-studio' ) );
		}
		check_admin_referer( 'pbs_reset_stats' );
		PBS_Stats::reset();
		wp_safe_redirect( admin_url( 'admin.php?page=' . self::SLUG . '&tab=dashboard&reset=1' ) );
		exit;
	}

	public static function ajax_test() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
		}
		check_ajax_referer( 'pbs_test' );
		$res = PBS_API::get( '/site/ping' );
		if ( is_wp_error( $res ) ) {
			wp_send_json_error( array( 'message' => $res->get_error_message() ) );
		}
		delete_transient( 'pbs_categories' );
		$origins  = isset( $res['site']['origins'] ) ? (array) $res['site']['origins'] : array();
		$home     = wp_parse_url( home_url() );
		$home_org = strtolower( $home['scheme'] . '://' . $home['host'] . ( isset( $home['port'] ) ? ':' . $home['port'] : '' ) );
		wp_send_json_success(
			array(
				'site'          => isset( $res['site']['name'] ) ? $res['site']['name'] : '',
				'services'      => isset( $res['services'] ) ? $res['services'] : array(),
				'originMatches' => in_array( $home_org, array_map( 'strtolower', $origins ), true ),
				'homeOrigin'    => $home_org,
			)
		);
	}

	/* ------------------------------- render ------------------------------ */

	public static function render() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$tab = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'dashboard';
		if ( ! array_key_exists( $tab, self::tabs() ) ) {
			$tab = 'dashboard';
		}
		$o = PBS_Options::all();
		?>
		<div class="wrap pbs-wrap" dir="rtl">
			<h1 class="pbs-title">
				<span class="pbs-logo" aria-hidden="true"></span>
				<?php esc_html_e( 'استودیو پرامپت باما', 'promptbama-studio' ); ?>
				<?php if ( PBS_Options::is_ready() ) : ?>
					<span class="pbs-badge pbs-badge-on"><?php esc_html_e( 'فعال', 'promptbama-studio' ); ?></span>
				<?php else : ?>
					<span class="pbs-badge"><?php esc_html_e( 'غیرفعال', 'promptbama-studio' ); ?></span>
				<?php endif; ?>
			</h1>

			<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
			<?php if ( isset( $_GET['saved'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'تنظیمات ذخیره شد.', 'promptbama-studio' ); ?></p></div>
			<?php endif; ?>

			<nav class="nav-tab-wrapper pbs-tabs">
				<?php foreach ( self::tabs() as $key => $label ) : ?>
					<a class="nav-tab <?php echo $key === $tab ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url( admin_url( 'admin.php?page=' . self::SLUG . '&tab=' . $key ) ); ?>"><?php echo esc_html( $label ); ?></a>
				<?php endforeach; ?>
			</nav>

			<div class="pbs-panel">
				<?php
				if ( 'dashboard' === $tab ) {
					self::tab_dashboard( $o );
				} else {
					self::form_open( $tab );
					call_user_func( array( __CLASS__, 'tab_' . $tab ), $o );
					self::form_close();
				}
				?>
			</div>
		</div>
		<?php
	}

	private static function form_open( $tab ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		echo '<input type="hidden" name="action" value="pbs_save">';
		echo '<input type="hidden" name="pbs_tab" value="' . esc_attr( $tab ) . '">';
		wp_nonce_field( 'pbs_save' );
		echo '<table class="form-table" role="presentation"><tbody>';
	}

	private static function form_close() {
		echo '</tbody></table>';
		submit_button( __( 'ذخیره تغییرات', 'promptbama-studio' ) );
		echo '</form>';
	}

	private static function row( $label, $html, $help = '', $for = '' ) {
		echo '<tr><th scope="row">';
		echo $for ? '<label for="' . esc_attr( $for ) . '">' . esc_html( $label ) . '</label>' : esc_html( $label );
		echo '</th><td>' . $html; // phpcs:ignore WordPress.Security.EscapeOutput -- built from escaped parts.
		if ( $help ) {
			echo '<p class="description">' . wp_kses( $help, array( 'code' => array(), 'strong' => array(), 'a' => array( 'href' => array(), 'target' => array() ) ) ) . '</p>';
		}
		echo '</td></tr>';
	}

	private static function input( $key, $value, $type = 'text', $attrs = '' ) {
		$class = false === strpos( $attrs, 'class=' ) ? 'class="regular-text"' : '';
		return sprintf(
			'<input type="%1$s" id="pbs-%2$s" name="pbs[%2$s]" value="%3$s" %4$s %5$s>',
			esc_attr( $type ),
			esc_attr( $key ),
			esc_attr( $value ),
			$class,
			$attrs // Static attribute strings only.
		);
	}

	private static function textarea( $key, $value, $rows = 3 ) {
		return sprintf(
			'<textarea id="pbs-%1$s" name="pbs[%1$s]" rows="%2$d" class="large-text">%3$s</textarea>',
			esc_attr( $key ),
			(int) $rows,
			esc_textarea( $value )
		);
	}

	private static function checkbox( $key, $checked, $label ) {
		return sprintf(
			'<label><input type="checkbox" name="pbs[%1$s]" value="1" %2$s> %3$s</label>',
			esc_attr( $key ),
			checked( ! empty( $checked ), true, false ),
			esc_html( $label )
		);
	}

	/* ------------------------------- tabs -------------------------------- */

	/** Version box: installed vs GitHub, with a "check now" button. */
	private static function update_card() {
		$info   = PBS_Updater::remote();
		$remote = $info['version'];
		$newer  = $remote && version_compare( $remote, PBS_VERSION, '>' );
		echo '<div class="pbs-card"><h2>' . esc_html__( 'نسخه و به‌روزرسانی', 'promptbama-studio' ) . '</h2><p>';
		echo esc_html__( 'نسخه‌ی نصب‌شده:', 'promptbama-studio' ) . ' <strong>' . esc_html( PBS_VERSION ) . '</strong> · ';
		echo esc_html__( 'آخرین نسخه در گیت‌هاب:', 'promptbama-studio' ) . ' <strong>' . esc_html( $remote ? $remote : '—' ) . '</strong>';
		if ( ! empty( $info['error'] ) ) {
			echo '<br><span class="pbs-muted">' . esc_html__( 'خطا در دریافت از گیت‌هاب:', 'promptbama-studio' ) . ' ' . esc_html( $info['error'] ) . '</span>';
		}
		echo '</p><p>';
		if ( $newer ) {
			$url = wp_nonce_url( self_admin_url( 'update.php?action=upgrade-plugin&plugin=' . rawurlencode( plugin_basename( PBS_FILE ) ) ), 'upgrade-plugin_' . plugin_basename( PBS_FILE ) );
			echo '<a class="button button-primary" href="' . esc_url( $url ) . '">' . esc_html( sprintf( __( 'به‌روزرسانی به %s', 'promptbama-studio' ), $remote ) ) . '</a> ';
		}
		echo '<a class="button" href="' . esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=pbs_check_update' ), 'pbs_check_update' ) ) . '">' . esc_html__( 'بررسی الان', 'promptbama-studio' ) . '</a>';
		echo '</p></div>';
	}

	private static function tab_dashboard( $o ) {
		$days   = 30;
		$totals = PBS_Stats::totals( $days );
		$events = PBS_Stats::events();

		self::update_card();

		if ( ! PBS_Options::is_ready() ) {
			echo '<div class="pbs-card pbs-card-warn"><h2>' . esc_html__( 'شروع کار', 'promptbama-studio' ) . '</h2><ol>';
			echo '<li>' . esc_html__( 'از پرامپت باما «کلید سایت» و «رمز سایت» بگیرید.', 'promptbama-studio' ) . '</li>';
			echo '<li>' . esc_html__( 'در تب «اتصال» وارد کنید، اتصال را آزمایش کنید و افزونه را روشن کنید.', 'promptbama-studio' ) . '</li>';
			echo '<li>' . esc_html__( 'در تب «محل نمایش» بگویید کارت در کدام مطالب و بعد از چند پاراگراف بیاید.', 'promptbama-studio' ) . '</li>';
			echo '</ol></div>';
		}

		echo '<div class="pbs-card"><h2>' . sprintf( esc_html__( 'قیف تبدیل — %d روز اخیر', 'promptbama-studio' ), (int) $days ) . '</h2>';
		echo '<table class="widefat striped pbs-funnel"><thead><tr><th>' . esc_html__( 'مرحله', 'promptbama-studio' ) . '</th>';
		echo '<th>' . esc_html__( 'طرح اول (سیاه و نئون)', 'promptbama-studio' ) . '</th><th>' . esc_html__( 'طرح دوم (احساسی)', 'promptbama-studio' ) . '</th></tr></thead><tbody>';
		foreach ( $events as $event => $label ) {
			echo '<tr><td>' . esc_html( $label ) . '</td>';
			foreach ( array( 'a', 'b' ) as $v ) {
				$n    = (int) $totals[ $v ][ $event ];
				$base = max( 1, (int) $totals[ $v ]['view'] );
				$pct  = 'view' === $event ? '' : ' <span class="pbs-muted">(' . esc_html( number_format_i18n( $n * 100 / $base, 1 ) ) . '٪)</span>';
				echo '<td><strong>' . esc_html( number_format_i18n( $n ) ) . '</strong>' . $pct . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput
			}
			echo '</tr>';
		}
		echo '</tbody></table>';
		echo '<p class="description">' . esc_html__( 'درصدها نسبت به «دیدن کارت» همان طرح است. شمارنده‌ها بی‌نام‌اند و اطلاعات شخصی ذخیره نمی‌کنند.', 'promptbama-studio' ) . '</p>';
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" onsubmit="return confirm(\'' . esc_js( __( 'آمار صفر شود؟', 'promptbama-studio' ) ) . '\')">';
		echo '<input type="hidden" name="action" value="pbs_reset_stats">';
		wp_nonce_field( 'pbs_reset_stats' );
		submit_button( __( 'صفر کردن آمار', 'promptbama-studio' ), 'secondary small', 'submit', false );
		echo '</form></div>';

		if ( PBS_Options::is_ready() && '' !== $o['site_secret'] ) {
			$remote = get_transient( 'pbs_remote_stats' );
			if ( false === $remote ) {
				$remote = PBS_API::get( '/site/stats', array( 'days' => $days ) );
				if ( ! is_wp_error( $remote ) ) {
					set_transient( 'pbs_remote_stats', $remote, 10 * MINUTE_IN_SECONDS );
				}
			}
			echo '<div class="pbs-card"><h2>' . esc_html__( 'از سمت پرامپت باما', 'promptbama-studio' ) . '</h2>';
			if ( is_wp_error( $remote ) ) {
				echo '<p class="pbs-error">' . esc_html( $remote->get_error_message() ) . '</p>';
			} else {
				$items = array(
					__( 'کاربران ثبت‌نام‌شده از این سایت (کل)', 'promptbama-studio' ) => number_format_i18n( (int) $remote['signupsTotal'] ),
					__( 'ثبت‌نام در بازه', 'promptbama-studio' ) => number_format_i18n( (int) $remote['signupsInRange'] ),
					__( 'پرداخت‌های موفق این کاربران', 'promptbama-studio' ) => number_format_i18n( (int) $remote['paymentsInRange'] ),
					__( 'مبلغ پرداخت‌ها (تومان)', 'promptbama-studio' ) => number_format_i18n( (int) $remote['revenueTomanInRange'] ),
					__( 'پرتره‌های تحویل‌شده', 'promptbama-studio' ) => number_format_i18n( (int) $remote['completedGenerationsInRange'] ),
				);
				echo '<div class="pbs-kpis">';
				foreach ( $items as $label => $value ) {
					echo '<div class="pbs-kpi"><span>' . esc_html( $label ) . '</span><strong>' . esc_html( $value ) . '</strong></div>';
				}
				echo '</div>';
			}
			echo '</div>';
		}

		echo '<div class="pbs-card"><h2>' . esc_html__( 'نمایش دستی', 'promptbama-studio' ) . '</h2>';
		echo '<p>' . esc_html__( 'هر جای سایت که بخواهید:', 'promptbama-studio' ) . ' <code>[promptbama_studio]</code> — ' . esc_html__( 'با گزینه‌ها:', 'promptbama-studio' ) . ' <code>[promptbama_studio variant="b" category="profile"]</code></p>';
		echo '<p>' . esc_html__( 'برای سایدبار: ابزارک «پرامپت باما — استودیو عکس» در نمایش › ابزارک‌ها.', 'promptbama-studio' ) . '</p></div>';
	}

	private static function tab_connection( $o ) {
		self::row( __( 'روشن', 'promptbama-studio' ), self::checkbox( 'enabled', $o['enabled'], __( 'ویجت در سایت نمایش داده شود', 'promptbama-studio' ) ) );
		self::row(
			__( 'آدرس سرویس', 'promptbama-studio' ),
			self::input( 'api_base', $o['api_base'], 'url', 'dir="ltr"' ),
			__( 'آدرس سایت پرامپت باما (یا هر سایت هم‌خانواده با همین کد).', 'promptbama-studio' ),
			'pbs-api_base'
		);
		self::row(
			__( 'کلید سایت', 'promptbama-studio' ),
			self::input( 'site_key', $o['site_key'], 'text', 'dir="ltr" autocomplete="off"' ),
			__( 'کلید عمومی؛ در مرورگر بازدیدکننده استفاده می‌شود.', 'promptbama-studio' ),
			'pbs-site_key'
		);
		self::row(
			__( 'رمز سایت', 'promptbama-studio' ),
			self::input( 'site_secret', '', 'password', 'dir="ltr" autocomplete="new-password" placeholder="' . esc_attr( $o['site_secret'] ? '•••••••• ' . __( '(ذخیره شده)', 'promptbama-studio' ) : '' ) . '"' ),
			__( 'فقط روی سرور وردپرس می‌ماند (آزمایش اتصال و آمار). برای تغییر ندادن، خالی بگذارید.', 'promptbama-studio' ),
			'pbs-site_secret'
		);
		self::row(
			__( 'آزمایش اتصال', 'promptbama-studio' ),
			'<button type="button" class="button" id="pbs-test">' . esc_html__( 'آزمایش کن', 'promptbama-studio' ) . '</button> <span id="pbs-test-result" class="pbs-test-result" aria-live="polite"></span>',
			__( 'اول ذخیره کنید، بعد آزمایش کنید. آدرس این سایت باید در فهرست دامنه‌های مجاز پرامپت باما باشد.', 'promptbama-studio' )
		);
		self::row( __( 'لینک قوانین', 'promptbama-studio' ), self::input( 'terms_url', $o['terms_url'], 'url', 'dir="ltr"' ), '', 'pbs-terms_url' );
		self::row(
			__( 'لینک پشتیبانی تلگرام', 'promptbama-studio' ),
			self::input( 'support_url', $o['support_url'], 'url', 'dir="ltr" placeholder="https://t.me/your_support"' ),
			__( 'برای «راضی نبودی؟ پیام بده»، تضمین کیفیت و «رمز را فراموش کرده‌ام». خالی = این لینک‌ها پنهان می‌شوند.', 'promptbama-studio' ),
			'pbs-support_url'
		);
		self::row(
			__( 'توکن به‌روزرسانی گیت‌هاب', 'promptbama-studio' ),
			self::input( 'update_token', '', 'password', 'dir="ltr" autocomplete="off" placeholder="' . ( '' !== $o['update_token'] ? '•••••••• (ذخیره شده)' : 'github_pat_…' ) . '"' ),
			__( 'فقط اگر مخزن افزونه در گیت‌هاب خصوصی است: یک توکن فقط‌خواندنی (Contents: Read) برای همان مخزن. افزونه با آن نسخه‌ی جدید را از گیت‌هاب می‌گیرد.', 'promptbama-studio' ),
			'pbs-update_token'
		);
	}

	private static function tab_design( $o ) {
		$variants = array(
			'ab' => __( 'تست A/B — هر بازدیدکننده یکی از دو طرح را ثابت می‌بیند', 'promptbama-studio' ),
			'a'  => __( 'فقط طرح اول — سیاه و نئون', 'promptbama-studio' ),
			'b'  => __( 'فقط طرح دوم — احساسی', 'promptbama-studio' ),
		);
		$html = '';
		foreach ( $variants as $value => $label ) {
			$html .= sprintf(
				'<label class="pbs-radio"><input type="radio" name="pbs[variant]" value="%1$s" %2$s> %3$s</label><br>',
				esc_attr( $value ),
				checked( $o['variant'], $value, false ),
				esc_html( $label )
			);
		}
		self::row( __( 'طرح', 'promptbama-studio' ), $html );
		self::row(
			__( 'سهم طرح دوم در تست', 'promptbama-studio' ),
			self::input( 'ab_split', $o['ab_split'], 'number', 'min="0" max="100" step="5" class="small-text"' ) . ' ٪',
			__( '۵۰ یعنی نیمی از بازدیدکننده‌ها طرح دوم را می‌بینند.', 'promptbama-studio' ),
			'pbs-ab_split'
		);
		self::row(
			__( 'رنگ اصلی', 'promptbama-studio' ),
			self::input( 'accent', $o['accent'], 'text', 'class="pbs-color" data-default-color="#D7FF3D"' ),
			__( 'رنگ دکمه‌ها و برجسته‌ها. روی زمینه‌ی سیاه رنگ روشن بهتر دیده می‌شود.', 'promptbama-studio' ),
			'pbs-accent'
		);
		self::row(
			__( 'فونت', 'promptbama-studio' ),
			self::input( 'font_family', $o['font_family'], 'text', 'dir="ltr"' ),
			__( '<code>inherit</code> یعنی همان فونت قالب سایت. یا نام فونت، مثلاً <code>Vazirmatn</code> یا <code>IRANSans</code>.', 'promptbama-studio' ),
			'pbs-font_family'
		);
		self::row( __( 'امضا', 'promptbama-studio' ), self::checkbox( 'show_brand', $o['show_brand'], __( 'نمایش «با فناوری پرامپت باما» زیر ویجت', 'promptbama-studio' ) ) );
	}

	private static function tab_texts( $o ) {
		echo '<tr><td colspan="2"><h2 class="pbs-h">' . esc_html__( 'طرح اول — سیاه و نئون', 'promptbama-studio' ) . '</h2></td></tr>';
		self::row( __( 'برچسب بالا', 'promptbama-studio' ), self::input( 'a_eyebrow', $o['a_eyebrow'] ), '', 'pbs-a_eyebrow' );
		self::row( __( 'تیتر — خط اول', 'promptbama-studio' ), self::input( 'a_title_1', $o['a_title_1'] ), '', 'pbs-a_title_1' );
		self::row( __( 'تیتر — خط دوم (رنگی)', 'promptbama-studio' ), self::input( 'a_title_2', $o['a_title_2'] ), '', 'pbs-a_title_2' );
		self::row( __( 'متن زیر تیتر', 'promptbama-studio' ), self::textarea( 'a_sub', $o['a_sub'], 2 ) );
		self::row( __( 'دکمه', 'promptbama-studio' ), self::input( 'a_cta', $o['a_cta'] ), __( '<code>%s</code> جای اسم استایل انتخاب‌شده می‌نشیند.', 'promptbama-studio' ), 'pbs-a_cta' );

		echo '<tr><td colspan="2"><h2 class="pbs-h">' . esc_html__( 'طرح دوم — احساسی', 'promptbama-studio' ) . '</h2></td></tr>';
		self::row( __( 'برچسب بالا', 'promptbama-studio' ), self::input( 'b_eyebrow', $o['b_eyebrow'] ), '', 'pbs-b_eyebrow' );
		self::row( __( 'تیتر — خط اول', 'promptbama-studio' ), self::input( 'b_title_1', $o['b_title_1'] ), '', 'pbs-b_title_1' );
		self::row( __( 'تیتر — خط دوم (رنگی)', 'promptbama-studio' ), self::input( 'b_title_2', $o['b_title_2'] ), '', 'pbs-b_title_2' );
		self::row( __( 'متن زیر تیتر', 'promptbama-studio' ), self::textarea( 'b_sub', $o['b_sub'], 2 ) );
		self::row( __( 'جمله‌ی «تصور کن»', 'promptbama-studio' ), self::textarea( 'b_imagine', $o['b_imagine'], 2 ), __( 'فقط در نمای پهن نشان داده می‌شود. خالی = پنهان.', 'promptbama-studio' ) );
		self::row( __( 'زیرنویس قاب‌ها', 'promptbama-studio' ), self::textarea( 'b_captions', $o['b_captions'], 8 ), __( 'هر خط یک زیرنویس احساسی؛ به ترتیب زیر قاب‌ها می‌نشیند.', 'promptbama-studio' ) );
		self::row( __( 'دکمه‌ی باز کردن', 'promptbama-studio' ), self::input( 'b_more', $o['b_more'] ), '', 'pbs-b_more' );
		self::row( __( 'دکمه‌ی اصلی', 'promptbama-studio' ), self::input( 'b_cta', $o['b_cta'] ), '', 'pbs-b_cta' );
		self::row( __( 'نظر کاربر', 'promptbama-studio' ), self::textarea( 'testimonial_text', $o['testimonial_text'], 2 ), __( 'فقط نظر واقعی و با اجازه‌ی خود کاربر. خالی = پنهان.', 'promptbama-studio' ) );
		self::row( __( 'نام صاحب نظر', 'promptbama-studio' ), self::input( 'testimonial_name', $o['testimonial_name'] ), '', 'pbs-testimonial_name' );

		echo '<tr><td colspan="2"><h2 class="pbs-h">' . esc_html__( 'مشترک', 'promptbama-studio' ) . '</h2></td></tr>';
		self::row( __( 'پیام حریم خصوصی', 'promptbama-studio' ), self::textarea( 'privacy_text', $o['privacy_text'], 2 ) );
		self::row( __( 'متن تضمین کیفیت', 'promptbama-studio' ), self::input( 'guarantee_text', $o['guarantee_text'], 'text', 'class="large-text"' ), __( 'روی کارت نشان داده می‌شود. خالی = پنهان.', 'promptbama-studio' ) );
		self::row( __( 'تعداد سازندگان', 'promptbama-studio' ), self::input( 'social_count', $o['social_count'], 'number', 'min="0" class="small-text"' ), __( 'عدد واقعی را بگذار و با آمار داشبورد به‌روز کن. ۰ = پنهان.', 'promptbama-studio' ) );
		self::row( __( 'متن تعداد سازندگان', 'promptbama-studio' ), self::input( 'social_text', $o['social_text'], 'text', 'class="large-text"' ), __( '{n} جای عدد می‌نشیند.', 'promptbama-studio' ) );
		self::row( __( 'متن نوار شناور موبایل', 'promptbama-studio' ), self::input( 'floating_text', $o['floating_text'] ), '', 'pbs-floating_text' );
	}

	private static function tab_placement( $o ) {
		self::row( __( 'درج خودکار', 'promptbama-studio' ), self::checkbox( 'auto_insert', $o['auto_insert'], __( 'کارت به‌طور خودکار داخل مطالب بیاید', 'promptbama-studio' ) ) );
		self::row(
			__( 'بعد از پاراگراف', 'promptbama-studio' ),
			self::input( 'insert_after', $o['insert_after'], 'number', 'min="0" max="30" class="small-text"' ),
			__( '۰ یعنی ابتدای مطلب. اگر مطلب کوتاه‌تر باشد، کارت آخر مطلب می‌آید.', 'promptbama-studio' ),
			'pbs-insert_after'
		);

		$types = get_post_types( array( 'public' => true ), 'objects' );
		$html  = '';
		foreach ( $types as $type ) {
			if ( 'attachment' === $type->name ) {
				continue;
			}
			$html .= sprintf(
				'<label class="pbs-check"><input type="checkbox" name="pbs[post_types][]" value="%1$s" %2$s> %3$s</label>',
				esc_attr( $type->name ),
				checked( in_array( $type->name, (array) $o['post_types'], true ), true, false ),
				esc_html( $type->labels->singular_name )
			);
		}
		self::row( __( 'نوع محتوا', 'promptbama-studio' ), $html );

		$cats = get_categories( array( 'hide_empty' => false ) );
		$html = '<div class="pbs-scroll">';
		foreach ( $cats as $cat ) {
			$html .= sprintf(
				'<label class="pbs-check"><input type="checkbox" name="pbs[include_cats][]" value="%1$d" %2$s> %3$s <span class="pbs-muted">(%4$s)</span></label>',
				(int) $cat->term_id,
				checked( in_array( (int) $cat->term_id, array_map( 'intval', (array) $o['include_cats'] ), true ), true, false ),
				esc_html( $cat->name ),
				esc_html( number_format_i18n( $cat->count ) )
			);
		}
		$html .= '</div>';
		self::row( __( 'فقط این دسته‌ها', 'promptbama-studio' ), $html, __( 'هیچ‌کدام تیک نخورد = همه‌ی دسته‌ها. پیشنهاد: دسته‌های زیبایی، مد، عکس و سبک زندگی.', 'promptbama-studio' ) );

		self::row(
			__( 'مطالب مستثنا', 'promptbama-studio' ),
			self::input( 'exclude_ids', $o['exclude_ids'], 'text', 'dir="ltr" placeholder="12, 345"' ),
			__( 'شناسه‌ی مطالبی که کارت نباید در آن‌ها بیاید (مثلاً مطالب پزشکی یا خبری).', 'promptbama-studio' ),
			'pbs-exclude_ids'
		);
		self::row( __( 'نوار شناور موبایل', 'promptbama-studio' ), self::checkbox( 'floating_bar', $o['floating_bar'], __( 'بعد از رد شدن از کارت، نوار کوچک پایین صفحه نشان داده شود', 'promptbama-studio' ) ) );
		self::row(
			__( 'تعداد قاب‌ها', 'promptbama-studio' ),
			self::input( 'styles_limit', $o['styles_limit'], 'number', 'min="3" max="20" class="small-text"' ),
			'',
			'pbs-styles_limit'
		);
		self::row(
			__( 'طرح‌های دست‌چین', 'promptbama-studio' ),
			self::input( 'styles_tag', $o['styles_tag'], 'text', 'class="regular-text" dir="ltr" placeholder="widget"' ),
			__( 'نامک (slug) یک برچسب در پرامپت باما. فقط تصاویری که در پنل پرامپت باما این برچسب را دارند در کاروسل نمایش داده می‌شوند (ترتیب: جدیدترین). خالی = پرطرفدارترین‌ها بر اساس دسته‌ی مطلب.', 'promptbama-studio' ),
			'pbs-styles_tag'
		);
	}

	private static function tab_mapping( $o ) {
		$remote = PBS_API::categories();
		if ( is_wp_error( $remote ) ) {
			echo '<tr><td colspan="2"><div class="notice notice-warning inline"><p>' . esc_html__( 'دسته‌های پرامپت باما دریافت نشد:', 'promptbama-studio' ) . ' ' . esc_html( $remote->get_error_message() ) . '</p></div></td></tr>';
			$remote = array();
		}
		$options = function ( $selected ) use ( $remote ) {
			$html = '<option value="">' . esc_html__( '— پیش‌فرض —', 'promptbama-studio' ) . '</option>';
			foreach ( $remote as $c ) {
				$html .= sprintf(
					'<option value="%1$s" %2$s>%3$s</option>',
					esc_attr( $c['slug'] ),
					selected( $selected, $c['slug'], false ),
					esc_html( $c['name'] . ' (' . number_format_i18n( (int) $c['postCount'] ) . ')' )
				);
			}
			return $html;
		};

		self::row(
			__( 'دسته‌ی پیش‌فرض', 'promptbama-studio' ),
			'<select name="pbs[default_category]">' . str_replace( esc_html__( '— پیش‌فرض —', 'promptbama-studio' ), esc_html__( '— پرطرفدارترین‌ها —', 'promptbama-studio' ), $options( $o['default_category'] ) ) . '</select>', // phpcs:ignore
			__( 'برای مطالبی که دسته‌شان نگاشت نشده.', 'promptbama-studio' )
		);

		$map = (array) $o['category_map'];
		foreach ( get_categories( array( 'hide_empty' => false ) ) as $cat ) {
			$selected = isset( $map[ $cat->term_id ] ) ? $map[ $cat->term_id ] : '';
			self::row(
				$cat->name,
				'<select name="pbs[category_map][' . (int) $cat->term_id . ']">' . $options( $selected ) . '</select>' // phpcs:ignore
			);
		}
	}
}
