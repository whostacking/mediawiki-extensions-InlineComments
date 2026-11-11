InlineComments is a MediaWiki extension that allows users to highlight text on a page
and add comments to it, viewable inline within the page.

Comments are stored in a separate MediaWiki "slot", so they do not alter the wikitext,
while still being tied to the page and showing up on watchlists and recent changes.

This version (v2+) has been polished for:

- **Light/dark mode support** — All colours use Codex design tokens with safe hex
  fallbacks, supporting `.skin-theme-clientpref-day`, `.skin-theme-clientpref-night`,
  and `.skin-theme-clientpref-os` theme classes.

- **Floating UI-style panel placement** — Panels appear beside the highlighted text
  by default. If the panel would overflow the bottom of the viewport, it flips
  above the annotation. A final shift clamps the panel inside the viewport.
  Panels never obscure the highlighted text.

- **Hover and click interaction** — Panels fade in on hover of the highlighted
  text, and stay open (sticky) on click. A fade-out animation runs when the mouse
  leaves both the text and the panel. The panel never auto-hides if a comment
  textarea is visible.

- **Copy-link button** — Each comment shows a “Copy link” icon beside the Edit
  icon (Codex `link` icon, `cdxIconLink.svg`). Clicking it copies the full URL
  with `#annotation-<id>` to the clipboard; it no longer sets the anchor on
  hover/click. Opening a URL with `#annotation-<id>` still scrolls to and
  re-opens its panel on load.

- **Overview page** — **View inline comments** (user/preferences menu,
  `user-menu` via `SkinTemplateNavigation::Universal`) opens
  `Special:InlineComments`. The main panel lists all unclosed discussions
  across the wiki (click a row’s “Open” to jump to `#annotation-<id>`), and
  a `<details>`/`<summary>` disclosure lists closed discussions (annotations
  present in older revisions but removed from the current slot).

- **Reply, edit, and delete** — Users can reply to existing comments, edit their
  own comments, and delete their own replies. Edit mode is properly reset on
  deletion, and stale form elements are cleaned up.

- **Nested comments** — Reply comments are appended after parent comments in the
  DOM, ensuring they visually stack on top of their parent via z-index (last child
  gets z-index: 1001).

- **Anonymous viewing** — Controlled by the config variable
  `$wgInlineCommentsAnonsCanView` (default `true`). Hosters can disable anonymous
  viewing by setting `$wgInlineCommentsAnonsCanView = false;` in
  LocalSettings.php. The old `InlineCommentsCanView` hook has been replaced.

## Installation

Copy the extension into your extensions directory in a directory named
InlineComments.

Add `wfLoadExtension( 'InlineComments' );` to the end of LocalSettings.php.

## Using

If you have the "inlinecomments-add" user right (by default, available to all
logged-in users), if you select any text on a page, a small icon will appear. You can
add a comment by clicking the icon or typing ctrl+alt+m; a dialog will then appear
to add your comment.

If you click on an already existing comment or discussion, tools appear to either
close (delete) the discussion, or reply to it.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `$wgInlineCommentsAnonsCanView` | `true` | Whether anonymous users can view and interact with comments. |
| `$wgInlineCommentsCanEdit` | `false` for anonymous, `true` for logged-in | Whether edit/delete controls appear. |

Hosters can override these in `LocalSettings.php`:

```php
$wgInlineCommentsAnonsCanView = false;
```

## Uninstalling

You can uninstall the extension by removing `wfLoadExtension( 'InlineComments' );`
from LocalSettings.php.

Pages that have comments on them will become unaccessible after uninstalling because
MediaWiki does not know how to display them without the extension.

If you want the comment data to be retained you can add the following stub to
LocalSettings.php to tell MediaWiki to simply ignore all comments and not display
them:

```
$wgContentHandlers['annotation+json'] = FallbackContentHandler::class;
$wgHooks['MediaWikiServices'][] = static function ( $services ) {
        $services->addServiceManipulator( 'SlotRoleRegistry', static function ( $reg ) {
                if ( !$reg->isDefinedRole( 'inlinecomments' ) ) {
                        $reg->defineRoleWithModel(
                                'inlinecomments',
                                'annotation+json',
                                [ 'display' => 'none' ]
                        );
                }
        } );
};
```

Alternatively you can run the maintenance scripts included with this extension to
remove stored comment data:

- `removeComments.php` will delete all comments via MediaWiki edits. The comments
  will still be present on previous versions within the "inlinecomments" slot,
  which means that they will become unviewable if/when InlineComments is
  uninstalled - although they will of course be viewable again if it is
  re-installed.

- `convertComments.php` will convert the comments to something that MediaWiki
  understands without the extension installed. You can specify the following
  parameters:
  - `--format json` converts to JSON output.
  - `--format fallback` makes MediaWiki just show a not supported message.
  - `--format comments` undoes the work of the script.

The "json" and "fallback" formats only work if InlineComments is not installed.

```
cd extensions/InlineComments/maintenance
php removeComments.php
php convertCommentsToFallback.php --format fallback
```